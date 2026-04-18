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

let adminState = {}; 

// 🌟 [၁] ရုပ်ရှင်အသစ်တင်ရန် Command
bot.onText(/\/addmovie/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) return;

  adminState[chatId] = { step: 'WAITING_PHOTO', data: {} };
  bot.sendMessage(chatId, "🎬 ရုပ်ရှင်အသစ်တင်ရန် စတင်ပါပြီ။ \n\nပထမဆုံး **Poster ဓာတ်ပုံ** ကို ပို့ပေးပါ။");
});

// 🌟 [၂] ရုပ်ရှင်များကို ပြင်/ဖျက်ရန် Command
bot.onText(/\/manage/, async (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID) return;

  // နောက်ဆုံးတင်ထားသော ရုပ်ရှင် ၁၀ ကားကို ဆွဲယူမည်
  const movies = await Movie.find().sort({ createdAt: -1 }).limit(10);
  if(movies.length === 0) return bot.sendMessage(chatId, "🤷‍♂️ ရုပ်ရှင် မရှိသေးပါ။");

  // ရုပ်ရှင်နာမည်များကို Bot ခလုတ်များအဖြစ် ပြောင်းလဲမည်
  const keyboard = movies.map(m => ([{ text: `🎬 ${m.title}`, callback_data: `select_${m._id}` }]));
  
  bot.sendMessage(chatId, "⚙️ ပြင်ဆင်/ဖျက်လိုသော ရုပ်ရှင်ကို ရွေးပါ (နောက်ဆုံး ၁၀ ကား)", {
      reply_markup: { inline_keyboard: keyboard }
  });
});

// 🌟 [၃] Bot မှ ခလုတ်များ နှိပ်သောအခါ အလုပ်လုပ်မည့်စနစ်
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data; // ဥပမာ - select_123, del_123
  const messageId = query.message.message_id;

  // ကားတစ်ကားကို ရွေးလိုက်သောအခါ (ရွေးချယ်စရာ ခလုတ်များ ပြမည်)
  if (data.startsWith('select_')) {
      const id = data.split('_')[1];
      const movie = await Movie.findById(id);
      if(!movie) return bot.sendMessage(chatId, "❌ ရှာမတွေ့တော့ပါ။ ဖျက်ပြီးသား ဖြစ်နိုင်ပါသည်။");

      const opts = {
          reply_markup: {
              inline_keyboard: [
                  [{ text: "✏️ Title ပြင်မည်", callback_data: `editTitle_${id}` }, { text: "✏️ ခုနှစ် ပြင်မည်", callback_data: `editYear_${id}` }],
                  [{ text: "✏️ အညွှန်း ပြင်မည်", callback_data: `editSyn_${id}` }, { text: "🔗 Link ပြင်မည်", callback_data: `editLink_${id}` }],
                  [{ text: "🗑 အပြီးတိုင် ဖျက်မည်", callback_data: `del_${id}` }]
              ]
          }
      };
      bot.editMessageText(`ရွေးချယ်ထားသော ရုပ်ရှင်: **${movie.title}**\nဘာဆက်လုပ်ချင်ပါသလဲ?`, { chat_id: chatId, message_id: messageId, parse_mode: "Markdown", ...opts });
  }

  // ဖျက်မည်ကို နှိပ်သောအခါ
  if (data.startsWith('del_')) {
      const id = data.split('_')[1];
      await Movie.findByIdAndDelete(id);
      bot.editMessageText("✅ အောင်မြင်စွာ ဖျက်လိုက်ပါပြီ။ Website ကို Refresh လုပ်ကြည့်ပါ။", { chat_id: chatId, message_id: messageId });
  }

  // ပြင်ဆင်မည့် ခလုတ်များ နှိပ်သောအခါ (စာရိုက်ထည့်ရန် State မှတ်သားမည်)
  if (data.startsWith('editTitle_')) {
      const id = data.split('_')[1];
      adminState[chatId] = { step: 'EDIT_TITLE', movieId: id };
      bot.sendMessage(chatId, "✏️ **Title အသစ်** ကို ရိုက်ထည့်ပါ။");
  }
  if (data.startsWith('editYear_')) {
      const id = data.split('_')[1];
      adminState[chatId] = { step: 'EDIT_YEAR', movieId: id };
      bot.sendMessage(chatId, "✏️ **ခုနှစ်အသစ်** ကို ရိုက်ထည့်ပါ။");
  }
  if (data.startsWith('editSyn_')) {
      const id = data.split('_')[1];
      adminState[chatId] = { step: 'EDIT_SYNOPSIS', movieId: id };
      bot.sendMessage(chatId, "✏️ **အညွှန်းအသစ်** ကို ရိုက်ထည့်ပါ။");
  }
  if (data.startsWith('editLink_')) {
      const id = data.split('_')[1];
      adminState[chatId] = { step: 'EDIT_LINK', movieId: id };
      bot.sendMessage(chatId, "🔗 **Telegram Link အသစ်** ကို ရိုက်ထည့်ပါ။");
  }
});

// 🌟 [၄] Bot သို့ စာနှင့် ပုံများ ပို့သောအခါ အလုပ်လုပ်မည့်စနစ်
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() !== ADMIN_CHAT_ID || !adminState[chatId]) return;

  const state = adminState[chatId];

  // --- အသစ်တင်သည့် စနစ် (Add Movie Steps) ---
  if (state.step === 'WAITING_PHOTO' && msg.photo) {
    state.data.posterFileId = msg.photo[msg.photo.length - 1].file_id;
    state.step = 'WAITING_TITLE';
    return bot.sendMessage(chatId, "✅ Poster ရရှိပါပြီ။ \n\nယခု **ရုပ်ရှင်အမည် (Movie Title)** ကို ရိုက်ထည့်ပါ။");
  }
  if (state.step === 'WAITING_TITLE' && msg.text) {
    state.data.title = msg.text;
    state.step = 'WAITING_YEAR';
    return bot.sendMessage(chatId, "✅ Title ရရှိပါပြီ။ \n\nယခု **ထွက်ရှိသည့် ခုနှစ် (Year)** ကို ရိုက်ထည့်ပါ။");
  }
  if (state.step === 'WAITING_YEAR' && msg.text) {
    state.data.year = msg.text;
    state.step = 'WAITING_SYNOPSIS';
    return bot.sendMessage(chatId, "✅ ခုနှစ် ရရှိပါပြီ။ \n\nယခု **အညွှန်း (Synopsis)** ကို ရိုက်ထည့်ပါ။");
  }
  if (state.step === 'WAITING_SYNOPSIS' && msg.text) {
    state.data.synopsis = msg.text;
    state.step = 'WAITING_LINK';
    return bot.sendMessage(chatId, "✅ အညွှန်း ရရှိပါပြီ။ \n\nနောက်ဆုံးအနေဖြင့် **Telegram Post Link** ကို ရိုက်ထည့်ပါ။");
  }
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
    return;
  }

  // --- ပြင်ဆင်သည့် စနစ် (Edit Movie Steps) ---
  try {
      if (state.step === 'EDIT_TITLE' && msg.text) {
          await Movie.findByIdAndUpdate(state.movieId, { title: msg.text });
          bot.sendMessage(chatId, "✅ Title အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
          delete adminState[chatId];
      }
      else if (state.step === 'EDIT_YEAR' && msg.text) {
          await Movie.findByIdAndUpdate(state.movieId, { year: msg.text });
          bot.sendMessage(chatId, "✅ ခုနှစ် အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
          delete adminState[chatId];
      }
      else if (state.step === 'EDIT_SYNOPSIS' && msg.text) {
          await Movie.findByIdAndUpdate(state.movieId, { synopsis: msg.text });
          bot.sendMessage(chatId, "✅ အညွှန်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
          delete adminState[chatId];
      }
      else if (state.step === 'EDIT_LINK' && msg.text) {
          await Movie.findByIdAndUpdate(state.movieId, { telegramLink: msg.text });
          bot.sendMessage(chatId, "✅ Link အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။");
          delete adminState[chatId];
      }
  } catch (error) {
      bot.sendMessage(chatId, "❌ ပြင်ဆင်ရာတွင် အမှားဖြစ်နေပါသည်။");
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
