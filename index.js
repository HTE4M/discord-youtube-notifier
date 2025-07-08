const { Client, GatewayIntentBits } = require('discord.js'); 
// นำเข้า discord.js สำหรับสร้างบอทและตั้งค่า intent ที่ต้องการ
const axios = require('axios'); 
// นำเข้า axios สำหรับดึงข้อมูลจาก URL (HTTP request)
const xml2js = require('xml2js'); 
// นำเข้า xml2js สำหรับแปลงข้อมูล XML เป็น JSON
const sqlite3 = require('sqlite3').verbose(); 
// นำเข้า sqlite3 สำหรับจัดการฐานข้อมูล SQLite

// กำหนดค่าต่าง ๆ สำหรับบอท เช่น token, channel สำหรับประกาศ, channel ID ของ YouTube, ระยะเวลาเช็คซ้ำ, และไฟล์ฐานข้อมูล
const config = {
  token: 'YOUR_DISCORD_TOKEN', // ใส่ token บอท Discord ของคุณ
  announceChannelId: 'YOUR_ANNOUNCE_CHANNEL_ID', // ID ของช่อง Discord ที่จะประกาศ
  youtubeChannelId: 'YOUR_YOUTUBE_CHANNEL_ID', // ID ช่อง YouTube ที่ต้องการติดตาม
  checkInterval: 300000, // เวลาเช็คซ้ำเป็นมิลลิวินาที (5 นาที)
  dbFile: 'videos.db' // ชื่อไฟล์ฐานข้อมูล SQLite
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, // ตั้งค่าให้บอทรู้จักเซิร์ฟเวอร์
    GatewayIntentBits.GuildMessages, // รับข้อความจากเซิร์ฟเวอร์
    GatewayIntentBits.MessageContent // อ่านเนื้อหาข้อความ
  ]
});

const db = new sqlite3.Database(config.dbFile); 
// สร้างหรือเปิดไฟล์ฐานข้อมูล SQLite

// สร้างตาราง videos สำหรับเก็บ videoId (ถ้ายังไม่มี)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS videos (
    videoId TEXT PRIMARY KEY
  )`);
});

// ฟังก์ชันช่วยดึงเวลาปัจจุบันในโซนเวลาประเทศไทย (Bangkok)
function getTimestamp() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
}

// ฟังก์ชันส่งข้อความประกาศไปยังช่อง Discord และแสดง log ในคอนโซล
function sendAnnouncement(channel, message, log) {
  channel.send(message);
  console.log(`[${getTimestamp()}] ${log}`);
}

// ดึง feed ของช่อง YouTube โดยใช้ axios และแปลง XML เป็น JSON ด้วย xml2js
async function fetchYouTubeFeed() {
  const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${config.youtubeChannelId}`);
  return xml2js.parseStringPromise(res.data);
}

// ฟังก์ชันแสดงจำนวน videoId ที่บันทึกไว้ในฐานข้อมูล
function logTotalVideos() {
  db.get(`SELECT COUNT(*) AS count FROM videos`, (err, row) => {
    if (err) return console.error(`❌ ดึงจำนวน videoId ไม่ได้: ${err.message}`);
    console.log(`✅ เก็บ videoId ปัจจุบัน ${row.count} รายการ`);
  });
}

// โหลด videoId ทั้งหมดจาก feed ของ YouTube ตอนบอทเริ่มทำงาน
async function preloadYouTubeVideos() {
  console.log(`📦 [${getTimestamp()}] กำลังโหลด videoId ทั้งหมดครั้งแรก...`);
  try {
    const parsed = await fetchYouTubeFeed();

    if (!parsed.feed.entry?.length) {
      console.log(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    // ดึง videoId ทุกตัวใน feed
    const videoIds = parsed.feed.entry.map(video => video['yt:videoId'][0]);

    // บันทึก videoId ลงฐานข้อมูล (ถ้ายังไม่มี)
    videoIds.forEach(videoId => {
      db.run(`INSERT OR IGNORE INTO videos (videoId) VALUES (?)`, [videoId], err => {
        if (err) console.error(`❌ preload videoId ไม่สำเร็จ: ${err.message}`);
      });
    });

    // แสดงจำนวน videoId หลังโหลดเสร็จ
    setTimeout(() => {
      logTotalVideos();
    }, 500);
  } catch (error) {
    console.error(`❌ preload videoId ไม่สำเร็จ:`, error.message);
  }
}

// เมื่อบอทพร้อมทำงาน
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await preloadYouTubeVideos(); // โหลด videoId เดิมที่มีอยู่
  setInterval(checkYouTube, config.checkInterval); // ตั้งเวลาเช็ค YouTube ทุก 5 นาที
});

// ฟังก์ชันเช็ค YouTube ว่ามีคลิปใหม่หรือไม่
async function checkYouTube() {
  console.log(`🔍 [${getTimestamp()}] เช็ค YouTube...`);

  try {
    const parsed = await fetchYouTubeFeed();

    if (!parsed.feed.entry?.length) {
      console.log(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    const latest = parsed.feed.entry[0]; // วิดีโอล่าสุด
    const videoId = latest['yt:videoId'][0];
    const videoTitle = latest.title[0];
    const announceChannel = client.channels.cache.get(config.announceChannelId);
    const titleLower = videoTitle.toLowerCase();

    // ตรวจสอบว่าคลิปนี้ถูกบันทึกไว้แล้วหรือไม่
    db.get(`SELECT videoId FROM videos WHERE videoId = ?`, [videoId], (err, row) => {
      if (err) return console.error(`❌ DB error: ${err.message}`);

      if (row) {
        // มีแล้ว ไม่ต้องประกาศซ้ำ
        console.log(`⏸️ ไม่พบวิดีโอใหม่`);
      } else {
        // ยังไม่มีในฐานข้อมูล แสดงว่าคลิปใหม่
        if (titleLower.includes('#live')) {
          // ถ้าเป็นไลฟ์
          sendAnnouncement(
            announceChannel,
            `🔴 ไลฟ์ใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`,
            `🔴 พบไลฟ์ใหม่: ${videoTitle}`
          );
        } else if (titleLower.includes('#shorts')) {
          // ถ้าเป็น Shorts
          sendAnnouncement(
            announceChannel,
            `📱 Shorts ใหม่บน YouTube: **${videoTitle}**\nhttps://www.youtube.com/shorts/${videoId}`,
            `📱 พบ Shorts ใหม่: ${videoTitle}`
          );
        } else {
          // วิดีโอทั่วไป
          sendAnnouncement(
            announceChannel,
            `🎥 คลิปใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`,
            `🎥 พบคลิปใหม่: ${videoTitle}`
          );
        }

        // บันทึก videoId ใหม่ลงฐานข้อมูล
        db.run(`INSERT INTO videos (videoId) VALUES (?)`, [videoId], err => {
          if (err) console.error(`❌ บันทึก videoId ไม่สำเร็จ: ${err.message}`);
          else logTotalVideos();
        });
      }
    });
  } catch (error) {
    console.error(`❌ เช็ค YouTube ไม่ได้:`, error.message);
  }
}

// เริ่มต้นเข้าสู่ระบบ Discord ด้วย token ที่กำหนด
client.login(config.token);
