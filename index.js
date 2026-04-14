const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const sharp = require('sharp');
const { getFirestore } = require('firebase-admin/firestore');

// 🔑 1. ตั้งค่า Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "order-rk.firebasestorage.app" 
});

const db = getFirestore('royalkissthneworder'); 
const bucket = admin.storage().bucket();

// 🔑 2. ตั้งค่า Token ของคุณเอส
const LINE_ACCESS_TOKEN = "3MHY+0vTPC5xnE7j3q1WPELPUSXd2qbKUx5gPRBuU7K2ciMqszVOzq/ClIez+iwTbJI1B+pw4/3IS0AmyW/z8hQvAE0iyImuQ+MpZUt91SF065PQj0EV4ZltxJQor/d9v+PIsLDEE7Y8Bxr8ErizUwdB04t89/1O/w1cDnyilFU=";
const FB_PAGE_ACCESS_TOKEN = "EAAT0f2OXGI0BRMsUozAUkL9TS3GyIdgdPmTjLlCbmNyS3r7QI4n7KUd2fd8bZB71verypzB5rQdy98uY0KkGfEHATVq2VT6juQaWW6K8IakFmGciz2zxRmFKyzaXfzlNmR3DlFxZCZBLCAESPZBBP4SgIbz2oWdn3yZBg2GSuZCawomA2tEZBosdYGWuZAkMgVUoZAVUzQmJZA9dnFIN49mFZBI";

const app = express();
app.use(cors());
app.use(express.json());

// 🌟 ตั้งค่า Port ให้รองรับการขึ้น Render อัตโนมัติ
const port = process.env.PORT || 3000;

// ==========================================
// 📁 ฟังก์ชันจัดการไฟล์และบันทึกข้อมูล
// ==========================================
async function uploadToStorage(buffer, filename) {
  try {
    const compressedBuffer = await sharp(buffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    const newFilename = filename.split('.')[0] + '.jpg';
    const file = bucket.file(`chats/${Date.now()}_${newFilename}`);
    await file.save(compressedBuffer, { contentType: 'image/jpeg' });
    const config = { action: 'read', expires: '03-01-2500' };
    const [url] = await file.getSignedUrl(config);
    return url;
  } catch (error) {
    console.error("🔥 พังตอนบีบอัด/อัปโหลดรูป:", error);
    return null;
  }
}

async function saveChatToFirebase(uid, platform, data) {
  try {
    await db.collection('chats').add({
      uid: uid, platform: platform, timestamp: admin.firestore.FieldValue.serverTimestamp(), isAdmin: false, ...data 
    });
    console.log(`✅ บันทึกลงฐานข้อมูลสำเร็จ [${platform}]`);
  } catch (error) {
    console.error("🔥 Firebase Save Error:", error);
  }
}

// ==========================================
// 📤 ฟังก์ชันส่งข้อความและรูปภาพกลับ (LINE & FB)
// ==========================================
async function sendLineMessage(uid, text) {
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN },
      body: JSON.stringify({ to: uid, messages: [{ type: 'text', text: text }] })
    });
  } catch (err) { console.error("🔥 ส่ง LINE พัง:", err); }
}

async function sendFacebookMessage(uid, text) {
  try {
    await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: uid }, message: { text: text } })
    });
  } catch (err) { console.error("🔥 ส่ง FB พัง:", err); }
}

async function sendLineImage(uid, imageUrl) {
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN },
      body: JSON.stringify({ to: uid, messages: [{ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl }] })
    });
  } catch (err) { console.error("🔥 ส่งรูป LINE พัง:", err); }
}

async function sendFacebookImage(uid, imageUrl) {
  try {
    await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: uid }, message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } } })
    });
  } catch (err) { console.error("🔥 ส่งรูป FB พัง:", err); }
}

// ==========================================
// 🟢 ส่วนรับ Webhook จาก LINE
// ==========================================
app.post('/webhook/line', async (req, res) => {
  res.status(200).send('OK');
  const events = req.body.events;
  if (!events || events.length === 0) return;

  const event = events[0];
  const uid = event.source.userId;

  if (event.type === 'message') {
    if (event.message.type === 'text') {
      await saveChatToFirebase(uid, "LINE", { text: event.message.text, type: "text" });
    } else if (event.message.type === 'image') {
      const messageId = event.message.id;
      const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, { headers: { 'Authorization': `Bearer ${LINE_ACCESS_TOKEN}` } });
      const buffer = Buffer.from(await response.arrayBuffer());
      const publicUrl = await uploadToStorage(buffer, `line_${messageId}.jpg`);
      await saveChatToFirebase(uid, "LINE", { imageUrl: publicUrl, text: "[รูปภาพ]", type: "image" });
    }
  }
});

// ==========================================
// 🔵 ส่วนรับ Webhook จาก Facebook
// ==========================================
app.get('/webhook/facebook', (req, res) => {
  const verifyToken = "easyfix+1239"; // 🌟 ดึง Verify Token กลับมาให้แล้วครับ
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.status(403).send('Verify Token ไม่ถูกต้อง');
  }
});

app.post('/webhook/facebook', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');
  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    if (!entry.messaging || entry.messaging.length === 0) continue;
    const webhook_event = entry.messaging[0];
    const uid = webhook_event.sender.id;

    if (webhook_event.message) {
      if (webhook_event.message.text) {
        await saveChatToFirebase(uid, "FACEBOOK", { text: webhook_event.message.text, type: "text" });
      } else if (webhook_event.message.attachments) {
        const attach = webhook_event.message.attachments[0];
        if (attach.type === 'image') {
          const response = await fetch(attach.payload.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          const publicUrl = await uploadToStorage(buffer, `fb_${uid}.jpg`);
          await saveChatToFirebase(uid, "FACEBOOK", { imageUrl: publicUrl, text: "[รูปภาพ]", type: "image" });
        }
      }
    }
  }
});

// ==========================================
// 👨‍💻 ประตูรับคำสั่งจาก "หน้าเว็บหลังบ้าน (Admin)"
// ==========================================
app.post('/api/admin/send', async (req, res) => {
  try {
    const data = req.body;
    if (data.action === "admin_reply") {
      if (data.platform === "LINE") await sendLineMessage(data.uid, data.text);
      else if (data.platform === "FACEBOOK") await sendFacebookMessage(data.uid, data.text);
    } else if (data.action === "send_image") {
       if (data.platform === "LINE") await sendLineImage(data.uid, data.image_url);
       else if (data.platform === "FACEBOOK") await sendFacebookImage(data.uid, data.image_url);
    }
    res.status(200).send({ success: true });
  } catch (err) {
    console.error("🔥 Admin Send Error:", err);
    res.status(500).send({ error: err.message });
  }
});

app.listen(port, () => console.log(`🚀 เซิร์ฟเวอร์รันที่พอร์ต ${port}`));