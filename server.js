require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.static('public'));

// --- MONGODB CHAT SETUP ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB ချိတ်ဆက်မှု အောင်မြင်ပါသည်!'))
  .catch((err) => console.log('MongoDB Error: ', err));

const movieSchema = new mongoose.Schema({
  title: String,
  year: String,
  synopsis: String,
  telegramLink: String, // 🌟 Link သိမ်းရန် အသစ်ထည့်ထားသည်
  posterFileId: String,
  createdAt: { type: Date, default: Date.now }
});
const Movie = mongoose.model('Movie', movieSchema);


// --- TELEGRAM BOT SETUP ---
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Bot ဖြင့် အမေးအဖြေလုပ်ရန် State မှတ်သားမည့် နေရာ
let adminState = {}; 

bot.onText(/\/addmovie/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) return bot.sendMessage(chatId, "သင်သည် Admin မဟုတ်ပါ။");

  adminState[chatId] = { step: 'WAITING_PHOTO', data: {} };
  bot.sendMessage(chatId, "🎬 ရုပ်ရှင်အသစ်တင်ရန် စတင်ပါပြီ။ \n\nပထမဆုံး **Poster ဓာတ်ပုံ** ကို ပို့ပေးပါ။");
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID || !adminState[chatId]) return;

  const state = adminState[chatId];

  if (state.step === 'WAITING_PHOTO' && msg.photo) {
    state.data.posterFileId = msg.photo[msg.photo.length - 1].file_id;
    state.step = 'WAITING_TITLE';
    return bot.sendMessage(chatId, "✅ Poster ရရှိပါပြီ။ \n\nယခု **ရုပ်ရှင်အမည် (Movie Title)** ကို ရိုက်ထည့်ပါ။");
  }

  if (state.step === 'WAITING_TITLE' && msg.text) {
    state.data.title = msg.text;
    state.step = 'WAITING_YEAR';
    return bot.sendMessage(chatId, "✅ Title ရရှိပါပြီ။ \n\nယခု **ထွက်ရှိသည့် ခုနှစ် (Year - ဥပမာ ၂၀၂၆)** ကို ရိုက်ထည့်ပါ။");
  }

  if (state.step === 'WAITING_YEAR' && msg.text) {
    state.data.year = msg.text;
    state.step = 'WAITING_SYNOPSIS';
    return bot.sendMessage(chatId, "✅ ခုနှစ် ရရှိပါပြီ။ \n\nယခု **အညွှန်း (Synopsis)** ကို ရိုက်ထည့်ပါ။");
  }

  // 🌟 အညွှန်းရပြီးပါက Link ကို ဆက်တောင်းပါမည်
  if (state.step === 'WAITING_SYNOPSIS' && msg.text) {
    state.data.synopsis = msg.text;
    state.step = 'WAITING_LINK';
    return bot.sendMessage(chatId, "✅ အညွှန်း ရရှိပါပြီ။ \n\nနောက်ဆုံးအနေဖြင့် **Telegram Post Link** ကို ရိုက်ထည့်ပါ။");
  }

  // 🌟 Link ရရှိပါက Database ထဲသို့ သိမ်းပါမည်
  if (state.step === 'WAITING_LINK' && msg.text) {
    state.data.telegramLink = msg.text;
    
    try {
      const newMovie = new Movie(state.data);
      await newMovie.save();
      bot.sendMessage(chatId, `🎉 အောင်မြင်စွာ တင်ပြီးပါပြီ!\n\nခေါင်းစဉ်: ${state.data.title}\nWebsite တွင် ဝင်ရောက်ကြည့်ရှုနိုင်ပါပြီ။`);
    } catch (err) {
      bot.sendMessage(chatId, "❌ Database သို့ သိမ်းဆည်းရာတွင် အမှားအယွင်းဖြစ်နေပါသည်။");
    }
    
    delete adminState[chatId];
  }
});

// --- WEBSITE (FRONTEND) အတွက် API များ ---

// ရုပ်ရှင်စာရင်း အားလုံးဆွဲယူရန်
app.get('/api/movies', async (req, res) => {
  const movies = await Movie.find().sort({ createdAt: -1 }); // အသစ်တင်တာ အရင်ပြရန်
  res.json(movies);
});

// ရုပ်ရှင်တစ်ခုချင်းစီ၏ အသေးစိတ် (အညွှန်းပါဝင်သည်) ဆွဲယူရန်
app.get('/api/movies/:id', async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    res.json(movie);
  } catch (err) {
    res.status(404).json({ error: "Movie not found" });
  }
});

// 🌟 Telegram ပုံများကို Website တွင် ဖော်ပြနိုင်ရန် Proxy လုပ်ပေးသည့် API
app.get('/api/image/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const fileLink = await bot.getFileLink(fileId); // Telegram API မှ Fresh Link ယူခြင်း
    res.redirect(fileLink); // ထို Link သို့ ပြန်လွှဲပေးခြင်း
  } catch (err) {
    res.status(500).send("Image Fetch Error");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}...`);
});
