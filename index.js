const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// config
const token = 'ใส่ Discord Bot Token ของคุณ';
const announceChannelId = 'ใส่ Channel ID ห้องประกาศ';
const YOUTUBE_CHANNEL_ID = 'ใส่ YouTube Channel ID';

// โหลด videoId ที่เคยโพสต์ไปแล้ว
let postedVideos = [];
if (fs.existsSync('postedVideos.json')) {
  postedVideos = JSON.parse(fs.readFileSync('postedVideos.json'));
}

// เมื่อบอทออนไลน์
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  checkFirstTime();
  setInterval(checkYouTube, 600000); // 10 นาที
});

// ฟังก์ชันเช็คและบันทึก videoId ตอนเปิดใช้ครั้งแรก
async function checkFirstTime() {
  if (postedVideos.length > 0) return;

  console.log(`📦 [${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] โหลด videoId ทั้งหมดของช่องครั้งแรก...`);

  try {
    const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`);
    const parsed = await xml2js.parseStringPromise(res.data);

    if (parsed.feed.entry && parsed.feed.entry.length > 0) {
      postedVideos = parsed.feed.entry.map(video => video['yt:videoId'][0]);
      fs.writeFileSync('postedVideos.json', JSON.stringify(postedVideos, null, 2));
      console.log(`✅ เก็บ videoId ปัจจุบัน ${postedVideos.length} รายการไว้เรียบร้อย`);
    } else {
      console.log(`📭 ช่องนี้ยังไม่มีวิดีโอ`);
    }
  } catch (error) {
    console.error(`❌ โหลด videoId ครั้งแรกไม่สำเร็จ:`, error.message);
  }
}

// เช็ค YouTube
async function checkYouTube() {
  console.log(`[${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}] 🔍 กำลังเช็ค YouTube...`);
  try {
    const res = await axios.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`);
    const parsed = await xml2js.parseStringPromise(res.data);

    if (!parsed.feed.entry || parsed.feed.entry.length === 0) {
      console.log(`📭 ยังไม่มีวิดีโอ`);
      return;
    }

    const latestVideo = parsed.feed.entry[0];
    const videoId = latestVideo['yt:videoId'][0];
    const videoTitle = latestVideo.title[0];

    if (!postedVideos.includes(videoId)) {
      const announceChannel = client.channels.cache.get(announceChannelId);
      const isShorts = videoTitle.toLowerCase().includes('#shorts');

      if (isShorts) {
        announceChannel.send(`📱 Shorts ใหม่บน YouTube: **${videoTitle}**\nhttps://www.youtube.com/shorts/${videoId}`);
        console.log(`📱 พบ Shorts ใหม่: ${videoTitle}`);
      } else {
        announceChannel.send(`🎥 คลิปใหม่บน YouTube: **${videoTitle}**\nhttps://youtu.be/${videoId}`);
        console.log(`🎥 พบคลิปใหม่: ${videoTitle}`);
      }

      // เพิ่ม videoId ลงไฟล์
      postedVideos.push(videoId);
      fs.writeFileSync('postedVideos.json', JSON.stringify(postedVideos, null, 2));
    } else {
      console.log(`⏸️ วิดีโอนี้เคยโพสต์แล้ว: ${videoTitle}`);
    }
  } catch (error) {
    console.error(`❌ เช็ค YouTube ไม่ได้:`, error.message);
  }
}

// เชื่อมต่อบอท
client.login(token);
