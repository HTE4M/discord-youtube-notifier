# 📺 Discord YouTube Notifier Bot

บอท Discord สำหรับตรวจสอบ YouTube Channel และแจ้งเตือนเมื่อมีคลิปใหม่ (รวมถึง Shorts) โดยโพสต์ลงห้องประกาศใน Discord อัตโนมัติ

---

## 📌 คุณสมบัติ

- เช็กวิดีโอใหม่จาก YouTube ทุกๆ 5 นาที
- แจ้งเตือนคลิปใหม่หรือ Shorts ลงในห้อง Discord ที่กำหนด (ในกรณี Shorts ให้ใส่ #shorts ไว้ในชื่อคลิปด้วย)
- บันทึก videoId ที่เคยโพสต์ไว้แล้ว เพื่อไม่ให้โพสต์ซ้ำ
- ใช้งานง่าย ไม่ต้องเชื่อม API Key ของ YouTube

---

## 📦 การติดตั้งและใช้งาน

### 1️⃣ ติดตั้ง Node.js

ดาวน์โหลดและติดตั้ง [Node.js (แนะนำเวอร์ชั่น 18 ขึ้นไป)](https://nodejs.org/)

---

### 2️⃣ Clone โปรเจกต์นี้

```bash
git clone https://github.com/HTE4M/discord-youtube-notifier.git
cd discord-youtube-notifier
```

### 3️⃣ ติดตั้ง dependencies

```bash
npm install discord.js axios xml2js sqlite3
```

### 4️⃣ ตั้งค่าข้อมูลใน `index.js`

แก้ไขค่าต่อไปนี้ในไฟล์ `index.js`

```javascript
const config = {
  token: 'ใส่ Discord Bot Token ของคุณ',
  announceChannelId: 'ใส่ Channel ID ห้องประกาศ',
  youtubeChannelId: 'ใส่ YouTube Channel ID',
  checkInterval: 300000,
  dbFile: 'videos.db'
};

```

#### 🔍 วิธีหา Channel ID ของ YouTube:
ไปที่หน้าช่อง YouTube → ดู URL เช่น  
`https://www.youtube.com/channel/UC1a2b3c4d5e6f_1a2b3c4d5e6f`  
คัดลอกเฉพาะ `UC1a2b3c4d5e6f_1a2b3c4d5e6f`

#### 🔍 วิธีหา Channel ID ของ Discord:
1. ไปที่ Discord → User Settings → Advanced → เปิด **Developer Mode**
2. คลิกขวาที่ชื่อห้องประกาศ → **Copy Channel ID**

#### 🔍 วิธีหา Discord Bot Token:
1. ไปที่ [Discord Developer Portal](https://discord.com/developers/applications)
2. สร้าง Application → Bot → Copy Token
3. เปิด Privileged Gateway Intents หรือ เปิด Presence Intent, Server Members Intent, Message Content Intent
4. เชิญ bot เข้า discord server
 `https://discord.com/oauth2/authorize?client_id=[ใส่ClientIDของบอท]&scope=bot&permissions=3072`

---

### 5️⃣ รันบอท

```bash
node index.js
```

#### ตัวอย่างข้อความแสดงผล:

```
✅ Logged in as [ชื่อบอท]
📦 โหลด videoId ทั้งหมดของช่องครั้งแรก...
✅ เก็บ videoId ปัจจุบัน [จำนวน] รายการไว้เรียบร้อย
```

---

## 🔍 การทำงานของระบบ

- โหลด videoId ของคลิปทั้งหมดจากช่อง YouTube ครั้งแรก (preload ลงฐานข้อมูล)
- ตั้งเวลาเช็ก YouTube ทุกๆ 5 นาที
- ถ้าพบวิดีโอใหม่ (videoId ไม่ซ้ำกับที่บันทึกไว้)
  - โพสต์ข้อความแจ้งเตือนใน Discord
  - เพิ่ม videoId ลงฐานข้อมูล
- ถ้าคลิปเดิม → ไม่โพสต์ซ้ำ

---

## 📃 ตัวอย่างข้อความที่โพสต์ใน Discord

**สำหรับ Shorts**

```
📱 Shorts ใหม่บน YouTube: [ชื่อคลิป]
https://www.youtube.com/shorts/[videoId]
```

**สำหรับวิดีโอปกติ**

```
🎥 คลิปใหม่บน YouTube: [ชื่อคลิป]
https://youtu.be/[videoId]
```

---

## 📂 ไฟล์ที่เกี่ยวข้อง

| ไฟล์                  | รายละเอียด                          |
|:----------------------|:-------------------------------------|
| `index.js`             | ไฟล์หลักของระบบบอท                 |
| `videos.db`    | ฐานข้อมูล SQLite เก็บ videoId      |
| `package.json`         | กำหนด dependencies (ถ้ามี)         |
| `README.md`            | คู่มือการติดตั้งและใช้งาน           |

---

## 📌 วิธีเปิด Developer Mode ใน Discord

1. ไปที่ User Settings
2. เลือก **Advanced**
3. เปิด **Developer Mode**
4. คลิกขวาที่ห้อง → **Copy Channel ID**

---

## ✅ หมายเหตุ

- ตัวบอทนี้ **ไม่ต้องใช้ YouTube API Key**
- ใช้ข้อมูลจาก **RSS feed ของ YouTube**  
  `https://www.youtube.com/feeds/videos.xml?channel_id=...`

### 📌 หากต้องการให้รันตลอดเวลา:
- ใช้งานร่วมกับ **pm2** หรือ **screen** บนเซิร์ฟเวอร์จะสะดวกมาก
- หากต้องการข้อมูลเพิ่มเติม หรือ วิธีติดตั้งอย่างละเอียด ติดต่อเข้ามาได้ที่ [Facebook](https://www.facebook.com/AhnYoung.KPDA)
