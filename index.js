require('dotenv').config(); // โหลดค่า environment variables จาก .env
const { Client, GatewayIntentBits } = require('discord.js'); // นำเข้า discord.js
const axios = require('axios'); // สำหรับดึงข้อมูล HTTP
const xml2js = require('xml2js'); // แปลง XML เป็น JSON
const sqlite = require('sqlite'); // ใช้งาน SQLite แบบ promise
const sqlite3 = require('sqlite3'); // ไดร์เวอร์ SQLite

// กำหนดค่าคอนฟิกต่างๆ ของบอท
const config = {
  token: process.env.DISCORD_TOKEN, // Token บอท Discord เก็บใน .env
  announceChannelId: 'YOUR_ANNOUNCE_CHANNEL_ID', // ID ช่องสำหรับโพสต์แจ้งเตือน
  youtubeChannelId: 'YOUR_YOUTUBE_CHANNEL_ID', // ช่อง YouTube ที่ต้องการตรวจสอบ
  checkInterval: 300000, // เวลาระหว่างตรวจสอบ (5 นาที)
  dbFile: 'videos.db' // ไฟล์ SQLite สำหรับเก็บ videoId
};

// สร้าง client Discord พร้อมระบุ intents ที่ต้องการ
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // ใช้งาน guild (เซิร์ฟเวอร์)
    GatewayIntentBits.GuildMessages, // อ่านข้อความใน guild
    GatewayIntentBits.MessageContent // อ่านเนื้อหาข้อความ (message content)
  ]
});

let db; // ตัวแปรเก็บฐานข้อมูล SQLite

// ฟังก์ชันช่วยคืนเวลาปัจจุบันใน timezone กรุงเทพฯ
function getTimestamp() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// ฟังก์ชันส่งข้อความแจ้งเตือนในช่อง Discord และพิมพ์ log
async function sendAnnouncement(channel, message, log) {
  if (channel) {
    await channel.send(message);
    console.log(`[${getTimestamp()}] ${log}`);
  } else {
    console.log(`❌ ไม่พบ announceChannel ID: ${config.announceChannelId}`);
  }
}

// ฟังก์ชันโหลด YouTube feed พร้อมระบบ retry (3 ครั้ง) กรณีล้มเหลว
async function fetchYouTubeFeedWithRetry(retries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // ดึง feed แบบ XML
      const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtubeChannelId}`);
      // แปลง XML เป็น JSON
      return xml2js.parseStringPromise(res.data);
    } catch (error) {
      console.warn(`⚠️ โหลด YouTube feed ล้มเหลว (attempt ${attempt}): ${error.message}`);
      if (attempt < retries) {
        // รอเวลา delay * attempt (เพิ่มขึ้นเรื่อยๆ) ก่อนลองใหม่
        await new Promise(res => setTimeout(res, delay * attempt));
      } else {
        // ถ้า retry ครบแล้วแต่ยังล้มเหลว ให้ throw error ออกไป
        throw error;
      }
    }
  }
}

// ฟังก์ชันแสดงจำนวนวิดีโอที่บันทึกในฐานข้อมูล
async function logTotalVideos() {
  const row = await db.get(`SELECT COUNT(*) AS count FROM videos`);
  console.log(`✅ เก็บ videoId ปัจจุบัน ${row.count} รายการ`);
}

// โหลด videoId ทั้งหมดจาก YouTube feed ครั้งแรกตอนบอทเริ่มทำงาน
async function preloadYouTubeVideos() {
  console.log(`📦 [${getTimestamp()}] กำลังโหลด videoId ทั้งหมดครั้งแรก...`);
  try {
    const parsed = await fetchYouTubeFeedWithRetry();

    // ถ้าไม่มีวิดีโอใน feed
    if (!parsed.feed.entry?.length) {
      console.log(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    // ดึง videoId ทั้งหมดจาก feed
    const videoIds = parsed.feed.entry.map(video => video['yt:videoId'][0]);

    // บันทึก videoId ลงฐานข้อมูล ถ้ามีอยู่แล้วจะไม่เพิ่มซ้ำ
    for (const videoId of videoIds) {
      await db.run(`INSERT OR IGNORE INTO videos (videoId) VALUES (?)`, videoId);
    }

    await logTotalVideos();
  } catch (error) {
    console.error(`❌ preload videoId ไม่สำเร็จ:`, error.message);
  }
}

// ฟังก์ชันตรวจสอบวิดีโอใหม่ใน YouTube feed ทุกๆ 5 นาที
async function checkYouTube() {
  console.log(`🔍 [${getTimestamp()}] เช็ค YouTube...`);
  try {
    const parsed = await fetchYouTubeFeedWithRetry();

    if (!parsed.feed.entry?.length) {
      console.log(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    const announceChannel = client.channels.cache.get(config.announceChannelId);

    // วนลูปตรวจทุกวิดีโอใน feed
    for (const entry of parsed.feed.entry) {
      const videoId = entry['yt:videoId'][0];
      const videoTitle = entry.title[0];
      const titleLower = videoTitle.toLowerCase();

      // เช็คในฐานข้อมูลว่ามี videoId นี้แล้วหรือยัง
      const row = await db.get(`SELECT videoId FROM videos WHERE videoId = ?`, videoId);
      if (row) {
        // ถ้ามีแล้ว ไม่ต้องแจ้งซ้ำ
        console.log(`⏸️ ${videoTitle} - มีอยู่แล้ว`);
        continue;
      }

      // ประเภทวิดีโอ แยกเป็น ไลฟ์, Shorts หรือ คลิปปกติ
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
    console.error(`❌ เช็ค YouTube ไม่ได้:`, error.message);
  }
}

// เมื่อบอทพร้อมใช้งาน (login สำเร็จ)
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // เปิดฐานข้อมูล SQLite
  db = await sqlite.open({ filename: config.dbFile, driver: sqlite3.Database });

  // สร้างตาราง videos หากยังไม่มี
  await db.run(`CREATE TABLE IF NOT EXISTS videos (videoId TEXT PRIMARY KEY)`);

  // โหลด videoId ทั้งหมดจาก YouTube feed ครั้งแรก
  await preloadYouTubeVideos();

  // ตั้ง interval ตรวจสอบ YouTube ทุกๆ 5 นาที
  setInterval(checkYouTube, config.checkInterval);
});

// เริ่มล็อกอินบอทด้วย token
client.login(config.token);
