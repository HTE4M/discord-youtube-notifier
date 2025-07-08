// โหลด environment variables จาก .env
require('dotenv').config();

// import module ที่จำเป็น
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const xml2js = require('xml2js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// 📌 config การตั้งค่าของระบบ
const config = {
  token: process.env.DISCORD_TOKEN, // ดึง token จาก .env
  announceChannelId: 'YOUR_ANNOUNCE_CHANNEL_ID', // ID ช่องสำหรับโพสต์แจ้งเตือน
  youtubeChannelId: 'YOUR_YOUTUBE_CHANNEL_ID', // ช่อง YouTube ที่ต้องการตรวจสอบ
  checkInterval: 300000, // ระยะเวลาเช็กวิดีโอทุก 5 นาที (หน่วยเป็น ms)
  dbFile: 'videos.db' // ชื่อไฟล์ database SQLite
};

// 📌 สร้าง client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

// ตัวแปร db สำหรับเชื่อมต่อฐานข้อมูล
let db;

// 📌 คืน timestamp ปัจจุบัน (เวลาประเทศไทย)
function getTimestamp() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// 📌 คืน path ของ log file ตามวันที่ (สร้างโฟลเดอร์ logs อัตโนมัติ)
function getLogFilePath() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // yyyy-mm-dd
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  return path.join(logDir, `${dateStr}.log`);
}

// 📌 เขียน log ลง console และไฟล์ log
function writeLog(message) {
  const logLine = `[${getTimestamp()}] ${message}\n`;
  console.log(logLine.trim());
  fs.appendFile(getLogFilePath(), logLine, err => {
    if (err) console.error(`❌ เขียน log ลงไฟล์ไม่สำเร็จ: ${err.message}`);
  });
}

// 📌 ส่งข้อความประกาศไปยัง Discord channel พร้อม log
async function sendAnnouncement(channel, message, log) {
  if (channel) {
    await channel.send(message);
    writeLog(log);
  } else {
    writeLog(`❌ ไม่พบ announceChannel ID: ${config.announceChannelId}`);
  }
}

// 📌 ดึง YouTube Feed พร้อมระบบ retry หากเกิด error
async function fetchYouTubeFeedWithRetry(retries = 3, delay = 1000, totalTimeLimit = 10000) {
  const startTime = Date.now();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtubeChannelId}`);
      return xml2js.parseStringPromise(res.data);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      writeLog(`⚠️ โหลด YouTube feed ล้มเหลว (attempt ${attempt}): ${error.message}`);

      if (elapsed >= totalTimeLimit) {
        writeLog(`⛔ เวลาโหลดรวมเกิน ${totalTimeLimit / 1000} วินาที ยกเลิก`);
        throw error;
      }

      if (attempt < retries) {
        await new Promise(res => setTimeout(res, delay * attempt));
      } else {
        throw error;
      }
    }
  }
}

// 📌 log จำนวน videoId ที่บันทึกไว้ในฐานข้อมูล
async function logTotalVideos() {
  const row = await db.get(`SELECT COUNT(*) AS count FROM videos`);
  writeLog(`✅ เก็บ videoId ปัจจุบัน ${row.count} รายการ`);
}

// 📌 โหลด videoId ทั้งหมดใน channel ลง database เมื่อบอทเปิดใหม่
async function preloadYouTubeVideos() {
  writeLog(`📦 กำลังโหลด videoId ทั้งหมดครั้งแรก...`);
  try {
    const parsed = await fetchYouTubeFeedWithRetry();
    if (!parsed.feed.entry?.length) {
      writeLog(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    const videoIds = parsed.feed.entry.map(video => video['yt:videoId'][0]);

    for (const videoId of videoIds) {
      await db.run(`INSERT OR IGNORE INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos();
  } catch (error) {
    writeLog(`❌ preload videoId ไม่สำเร็จ: ${error.message}`);
  }
}

// 📌 ตรวจสอบ YouTube feed ว่ามีวิดีโอใหม่ไหม
async function checkYouTube() {
  writeLog(`🔍 เช็ค YouTube...`);
  try {
    const parsed = await fetchYouTubeFeedWithRetry();
    if (!parsed.feed.entry?.length) {
      writeLog(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    const announceChannel = client.channels.cache.get(config.announceChannelId);

    for (const entry of parsed.feed.entry) {
      const videoId = entry['yt:videoId'][0];
      const videoTitle = entry.title[0];
      const titleLower = videoTitle.toLowerCase();

      // เช็กว่า videoId นี้อยู่ในฐานข้อมูลหรือยัง
      const row = await db.get(`SELECT videoId FROM videos WHERE videoId = ?`, videoId);
      if (row) {
        writeLog(`⏸️ ${videoTitle} - มีอยู่แล้ว`);
        continue;
      }

      // ถ้ายังไม่มี → แจ้งเตือนตามประเภทวิดีโอ
      if (titleLower.includes('#live')) {
        await sendAnnouncement(
          announceChannel,
          `🔴 ไลฟ์ใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`,
          `🔴 พบไลฟ์ใหม่: ${videoTitle}`
        );
      } else if (titleLower.includes('#shorts')) {
        await sendAnnouncement(
          announceChannel,
          `📱 Shorts ใหม่บน YouTube: **${videoTitle}**\nhttps://www.youtube.com/shorts/${videoId}`,
          `📱 พบ Shorts ใหม่: ${videoTitle}`
        );
      } else {
        await sendAnnouncement(
          announceChannel,
          `🎥 คลิปใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`,
          `🎥 พบคลิปใหม่: ${videoTitle}`
        );
      }

      // บันทึก videoId ใหม่ลงฐานข้อมูล
      await db.run(`INSERT INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos();
  } catch (error) {
    writeLog(`❌ เช็ค YouTube ไม่ได้: ${error.message}`);
  }
}

// 📌 เมื่อบอทออนไลน์ (พร้อมใช้งาน)
client.once('ready', async () => {
  writeLog(`✅ Logged in as ${client.user.tag}`);

  // เชื่อมต่อฐานข้อมูล SQLite
  db = await sqlite.open({ filename: config.dbFile, driver: sqlite3.Database });

  // สร้าง table videos ถ้ายังไม่มี
  await db.run(`CREATE TABLE IF NOT EXISTS videos (videoId TEXT PRIMARY KEY)`);

  // โหลด videoId ทั้งหมดครั้งแรก
  await preloadYouTubeVideos();

  // ตั้ง interval เช็ควิดีโอทุกระยะ
  setInterval(checkYouTube, config.checkInterval);
});

// 📌 login เข้า Discord
client.login(config.token);
