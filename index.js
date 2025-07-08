require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const xml2js = require('xml2js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// 📌 Config ระบบ
const config = {
  token: process.env.DISCORD_TOKEN, // token bot จาก .env
  announceChannelId: 'YOUR_ANNOUNCE_CHANNEL_ID', // ID ช่องสำหรับโพสต์แจ้งเตือน
  youtubeChannelId: 'YOUR_YOUTUBE_CHANNEL_ID', // ช่อง YouTube ที่ต้องการตรวจสอบ
  checkInterval: 300000, // เช็คทุก 5 นาที (300000 ms)
  dbFile: 'videos.db' // ไฟล์ database SQLite
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let db; // ตัวแปรเก็บ database instance

// 📌 คืน timestamp ปัจจุบัน (ตามเวลาไทย)
function getTimestamp() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// 📌 คืน path ไฟล์ log ตามวัน
function getLogFilePath() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  return path.join(logDir, `${dateStr}.log`);
}

// 📌 เขียน log ลง console + ไฟล์ log
function writeLog(message) {
  const logLine = `[${getTimestamp()}] ${message}\n`;
  console.log(logLine.trim());
  fs.appendFile(getLogFilePath(), logLine, err => {
    if (err) console.error(`❌ เขียน log ลงไฟล์ไม่สำเร็จ: ${err.message}`);
  });
}

// 📌 ส่งประกาศ Discord + เขียน log
async function sendAnnouncement(channel, message, log) {
  if (channel) {
    await channel.send(message);
    writeLog(log);
  } else {
    writeLog(`❌ ไม่พบ announceChannel ID: ${config.announceChannelId}`);
  }
}

// 📌 ดึง YouTube Feed พร้อมระบบ retry
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

// 📌 log จำนวน videoId ทั้งหมด และจำนวน video ใหม่ล่าสุด
async function logTotalVideos(beforeCount) {
  const row = await db.get(`SELECT COUNT(*) AS count FROM videos`);
  const afterCount = row.count;
  const newVideos = afterCount - beforeCount;
  writeLog(`✅ videoId ปัจจุบัน ${afterCount} รายการ (+${newVideos} รายการใหม่)`);
}

// 📌 preload videoId ทั้งหมดตอนบอทเปิด
async function preloadYouTubeVideos() {
  writeLog(`📦 กำลังโหลด videoId ทั้งหมดครั้งแรก...`);
  try {
    const beforeRow = await db.get(`SELECT COUNT(*) AS count FROM videos`);
    const beforeCount = beforeRow.count;

    const parsed = await fetchYouTubeFeedWithRetry();
    if (!parsed.feed.entry?.length) {
      writeLog(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    const videoIds = parsed.feed.entry.map(video => video['yt:videoId'][0]);

    for (const videoId of videoIds) {
      await db.run(`INSERT OR IGNORE INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos(beforeCount);
  } catch (error) {
    writeLog(`❌ preload videoId ไม่สำเร็จ: ${error.message}`);
  }
}

// 📌 เช็ค YouTube Feed ว่ามีวิดีโอใหม่ไหม
async function checkYouTube() {
  writeLog(`🔍 เช็ค YouTube...`);
  try {
    const beforeRow = await db.get(`SELECT COUNT(*) AS count FROM videos`);
    const beforeCount = beforeRow.count;

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

      const row = await db.get(`SELECT videoId FROM videos WHERE videoId = ?`, videoId);
      if (row) {
        writeLog(`⏸️ ${videoTitle} - มีอยู่แล้ว`);
        continue;
      }

      // 📌 ถ้า #live ใน title
      if (titleLower.includes('#live')) {
        await sendAnnouncement(
          announceChannel,
          `🔴 ไลฟ์ใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`,
          `🔴 พบไลฟ์ใหม่: ${videoTitle}`
        );
      }
      // 📌 ถ้า #shorts ใน title
      else if (titleLower.includes('#shorts')) {
        await sendAnnouncement(
          announceChannel,
          `📱 Shorts ใหม่บน YouTube: **${videoTitle}**\nhttps://www.youtube.com/shorts/${videoId}`,
          `📱 พบ Shorts ใหม่: ${videoTitle}`
        );
      }
      // 📌 วิดีโอปกติ
      else {
        await sendAnnouncement(
          announceChannel,
          `🎥 คลิปใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`,
          `🎥 พบคลิปใหม่: ${videoTitle}`
        );
      }

      await db.run(`INSERT INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos(beforeCount);
  } catch (error) {
    writeLog(`❌ เช็ค YouTube ไม่ได้: ${error.message}`);
  }
}

// 📌 บอทออนไลน์
client.once('ready', async () => {
  writeLog(`✅ Logged in as ${client.user.tag}`);
  db = await sqlite.open({ filename: config.dbFile, driver: sqlite3.Database });
  await db.run(`CREATE TABLE IF NOT EXISTS videos (videoId TEXT PRIMARY KEY)`);

  await preloadYouTubeVideos();

  // 📌 setInterval ครอบ try-catch กันพัง
  setInterval(async () => {
    try {
      await checkYouTube();
    } catch (err) {
      writeLog(`❌ ERROR ใน setInterval: ${err.message}`);
    }
  }, config.checkInterval);
});

// 📌 login เข้าบอท
client.login(config.token);
