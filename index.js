// 📦 โหลด environment variable จาก .env
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const xml2js = require('xml2js');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

// 📌 Config ของระบบ
const config = {
  token: process.env.DISCORD_TOKEN, // Token ของบอท Discord
  announceChannelId: 'YOUR_ANNOUNCE_CHANNEL_ID', // ID ช่องสำหรับโพสต์แจ้งเตือน
  youtubeChannelId: 'YOUR_YOUTUBE_CHANNEL_ID', // ช่อง YouTube ที่ต้องการตรวจสอบ
  checkInterval: 300000, // ความถี่เช็ควิดีโอใหม่ (หน่วย ms) = 5 นาที
  dbFile: 'videos.db' // ไฟล์ SQLite database สำหรับเก็บ videoId ที่เคยแจ้งแล้ว
};

// 📌 สร้าง client Discord ด้วย intents สำหรับข้อความในเซิร์ฟเวอร์
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let db;

// 📌 คืนเวลาปัจจุบันในรูปแบบไทย
function getTimestamp() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// 📌 คืน path สำหรับ log file ประจำวัน
function getLogFilePath() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  return path.join(logDir, `${dateStr}.log`);
}

// 📌 คืน path สำหรับ error log file ประจำวัน
function getErrorLogFilePath() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
  return path.join(logDir, `error-${dateStr}.log`);
}

// 📌 เขียน log ปกติ
function writeLog(message) {
  const logLine = `[${getTimestamp()}] ${message}\n`;
  console.log(logLine.trim());
  fs.appendFile(getLogFilePath(), logLine, (err) => {
    if (err) console.error(`❌ เขียน log ลงไฟล์ไม่สำเร็จ: ${err.message}`);
  });
}

// 📌 เขียน log error
function writeErrorLog(message) {
  const logLine = `[${getTimestamp()}] ${message}\n`;
  console.error(logLine.trim());
  fs.appendFile(getErrorLogFilePath(), logLine, (err) => {
    if (err) console.error(`❌ เขียน error log ไม่สำเร็จ: ${err.message}`);
  });
}

// 📌 ส่ง embed และ log ลง announce channel
async function sendEmbedAnnouncement(channel, embed, log) {
  if (channel) {
    await channel.send({ embeds: [embed] });
    writeLog(log);
  } else {
    writeLog(`❌ ไม่พบ announceChannel ID: ${config.announceChannelId}`);
  }
}

// 📌 โหลด YouTube feed พร้อม retry
async function fetchYouTubeFeedWithRetry(retries = 3, delay = 1000, totalTimeLimit = 10000) {
  const startTime = Date.now();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtubeChannelId}`;
      const res = await axios.get(url);
      writeLog(`✅ โหลด YouTube feed สำเร็จ (HTTP status: ${res.status})`);
      return xml2js.parseStringPromise(res.data);
    } catch (error) {
      const elapsed = Date.now() - startTime;
      writeErrorLog(`⚠️ โหลด YouTube feed ล้มเหลว (attempt ${attempt}): ${error.message}`);
      if (elapsed >= totalTimeLimit) throw error;
      if (attempt < retries) await new Promise((res) => setTimeout(res, delay * attempt));
      else throw error;
    }
  }
}

// 📌 log จำนวนวิดีโอในฐานข้อมูล
async function logTotalVideos(beforeCount) {
  const row = await db.get(`SELECT COUNT(*) AS count FROM videos`);
  const afterCount = row.count;
  const newVideos = afterCount - beforeCount;
  writeLog(`✅ videoId ปัจจุบัน ${afterCount} รายการ (+${newVideos} รายการใหม่)`);
}

// 📌 preload videoId ทั้งหมดลง database (กันการแจ้งซ้ำ)
async function preloadYouTubeVideos() {
  writeLog(`📦 กำลังโหลด videoId ทั้งหมดครั้งแรก...`);
  try {
    const beforeRow = await db.get(`SELECT COUNT(*) AS count FROM videos`);
    const beforeCount = beforeRow.count;

    const parsed = await fetchYouTubeFeedWithRetry();
    if (!parsed.feed.entry?.length) return;

    const videoIds = parsed.feed.entry.map((video) => video['yt:videoId'][0]);
    for (const videoId of videoIds) {
      await db.run(`INSERT OR IGNORE INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos(beforeCount);
  } catch (error) {
    writeErrorLog(`❌ preload videoId ไม่สำเร็จ: ${error.message}`);
  }
}

// 📌 เช็ควิดีโอใหม่จาก YouTube
async function checkYouTube() {
  writeLog(`🔍 เช็ค YouTube...`);
  try {
    const beforeRow = await db.get(`SELECT COUNT(*) AS count FROM videos`);
    const beforeCount = beforeRow.count;

    const parsed = await fetchYouTubeFeedWithRetry();
    if (!parsed.feed.entry?.length) return;

    const announceChannel = client.channels.cache.get(config.announceChannelId);

    for (const entry of parsed.feed.entry) {
      const videoId = entry['yt:videoId'][0];
      const videoTitle = entry.title[0];
      const titleLower = videoTitle.toLowerCase();
      const thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      const row = await db.get(`SELECT videoId FROM videos WHERE videoId = ?`, videoId);
      if (row) continue;

      let color, label;

      if (titleLower.includes('#live')) {
        label = '🔴 ไลฟ์ใหม่บน YouTube';
        color = 0xff3333;
        videoUrl = `https://youtu.be/${videoId}`;
      } else if (titleLower.includes('#shorts')) {
        label = '📱 Shorts ใหม่บน YouTube';
        color = 0x33ccff;
        videoUrl = `https://youtu.be/shorts/${videoId}`;
      } else {
        label = '🎥 คลิปใหม่บน YouTube';
        color = 0xffcc00;
        videoUrl = `https://youtu.be/${videoId}`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`${label}: ${videoTitle}`)
        .setURL(videoUrl)
        .setImage(thumbUrl)
        .setColor(color)
        .setFooter({ text: videoUrl })
        .setTimestamp();

      await sendEmbedAnnouncement(announceChannel, embed, `${label}: ${videoTitle}`);
      await db.run(`INSERT INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos(beforeCount);
  } catch (error) {
    writeErrorLog(`❌ เช็ค YouTube ไม่ได้: ${error.message}`);
  }
}

// 📌 เมื่อ client login สำเร็จ
client.once('ready', async () => {
  writeLog(`✅ Logged in as ${client.user.tag}`);

  if (config.checkInterval < 60000) {
    writeLog(`⚠️ WARNING: checkInterval ต่ำกว่า 60 วินาที อาจโดน YouTube cache`);
  }

  db = await sqlite.open({ filename: config.dbFile, driver: sqlite3.Database });
  await db.run(`CREATE TABLE IF NOT EXISTS videos (videoId TEXT PRIMARY KEY)`);
  await preloadYouTubeVideos();

  setInterval(async () => {
    try {
      await checkYouTube();
    } catch (err) {
      writeErrorLog(`❌ ERROR ใน setInterval: ${err.message}`);
    }
  }, config.checkInterval);
});

// 📌 login ด้วย token
client.login(config.token);
