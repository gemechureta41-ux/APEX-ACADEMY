const express = require('express');
const path = require('path');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Telegram Bot with polling
const token = process.env.TELEGRAM_BOT_TOKEN || '8961524303:AAEkBXJL2tPcS_1cvbLOEsk8_aTdpdKsbTQ';
const bot = new TelegramBot(token, { polling: true });

// In-Memory Databases
let userSessions = {}; 
let pendingApprovals = []; 
let approvedUsers = new Set(); 

console.log('🤖 Telegram Bot @apex_forex_assistant_bot is active...');

// --- TELEGRAM BOT LOGIC (ENGLISH) ---
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userSessions[chatId] = { step: 'AWAITING_EMAIL' };

    const welcomeMessage = `✨ *Welcome to Apex Forex Academy Official Bot!* ✨\n\nI am your automated enrollment assistant.\n\nTo begin your registration and access all 20 Premium Modules, please enter your *Email Address*:`;
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const session = userSessions[chatId];

    if (!session || text === '/start') return;

    if (session.step === 'AWAITING_EMAIL') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(text)) {
            return bot.sendMessage(chatId, '❌ Invalid email format. Please send a valid email address (e.g., student@gmail.com):');
        }

        session.email = text.trim().toLowerCase();
        session.step = 'AWAITING_PAYMENT_PROOF';

        const paymentInstructions = `✅ *Email Saved:* \`${session.email}\`\n\n💳 *Payment Details for VIP Access:*\n\nChoose one of the following methods to transfer the registration fee:\n\n📱 *Telebirr:* \`0917091612\`\n📱 *M-Pesa:* \`0717120607\`\n\n📌 *Next Step:* After completing the payment, please upload/send the *Receipt Screenshot* or Transaction Document right here in this chat.`;
        return bot.sendMessage(chatId, paymentInstructions, { parse_mode: 'Markdown' });
    }

    if (session.step === 'AWAITING_PAYMENT_PROOF') {
        let photoFileId = null;

        if (msg.photo && msg.photo.length > 0) {
            photoFileId = msg.photo[msg.photo.length - 1].file_id;
        } else if (msg.document) {
            photoFileId = msg.document.file_id;
        }

        if (!photoFileId) {
            return bot.sendMessage(chatId, '⚠️ Please upload an *Image (Screenshot)* or PDF receipt of your payment transaction.', { parse_mode: 'Markdown' });
        }

        try {
            const fileLink = await bot.getFileLink(photoFileId);

            const newRecord = {
                id: 'REQ-' + Date.now().toString().slice(-6),
                chatId: chatId,
                telegramUser: msg.from.username ? `@${msg.from.username}` : msg.from.first_name,
                email: session.email,
                receiptUrl: fileLink,
                date: new Date().toLocaleString(),
                status: 'PENDING'
            };

            pendingApprovals.unshift(newRecord);
            session.step = 'COMPLETED';

            const pendingNotice = `✅ *Payment Proof Received!*\n\nYour enrollment details have been submitted to the Admin Portal.\n\n🆔 *Request ID:* \`${newRecord.id}\`\n📧 *Email:* \`${session.email}\`\n\n⏳ Please wait while the Admin verifies your transaction. You will receive an instant notification here once approved!`;
            bot.sendMessage(chatId, pendingNotice, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error fetching photo link:', error);
            bot.sendMessage(chatId, '❌ An error occurred while processing your receipt. Please try uploading again.');
        }
    }
});


// --- WEB API ENDPOINTS ---
app.get('/api/admin/pending', (req, res) => {
    res.json({ success: true, data: pendingApprovals });
});

app.post('/api/admin/approve', (req, res) => {
    const { id } = req.body;
    const record = pendingApprovals.find(item => item.id === id);

    if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found' });
    }

    record.status = 'APPROVED';
    approvedUsers.add(record.email);

    const approvalMessage = `🎉 *CONGRATULATIONS! YOUR VIP ACCESS IS APPROVED!* 🎉\n\nYour payment has been successfully verified by the Admin.\n\n🔑 You can now log in to the Apex Forex Academy platform with your email: \`${record.email}\` and access all 20 Premium Modules, SMC charts, quizzes, and certificates.\n\n🌐 Open Website: https://apex-forex-academy.onrender.com`;
    bot.sendMessage(record.chatId, approvalMessage, { parse_mode: 'Markdown' });

    res.json({ success: true, message: `Request ${id} Approved and student notified via Telegram.` });
});

app.post('/api/admin/reject', (req, res) => {
    const { id, reason } = req.body;
    const record = pendingApprovals.find(item => item.id === id);

    if (!record) {
        return res.status(404).json({ success: false, message: 'Record not found' });
    }

    record.status = 'REJECTED';

    const rejectionMessage = `❌ *PAYMENT VERIFICATION FAILED*\n\nYour payment submission (ID: \`${record.id}\`) could not be verified by the Admin.\n\n📝 *Reason:* ${reason || 'Invalid transaction screenshot or unconfirmed payment.'}\n\nPlease verify your payment receipt and restart the registration using /start.`;
    bot.sendMessage(record.chatId, rejectionMessage, { parse_mode: 'Markdown' });

    res.json({ success: true, message: `Request ${id} Rejected and student notified via Telegram.` });
});

app.post('/api/user/check-status', (req, res) => {
    const { email } = req.body;
    const cleanEmail = email ? email.trim().toLowerCase() : '';

    if (approvedUsers.has(cleanEmail)) {
        return res.json({ success: true, isApproved: true });
    }
    
    const pending = pendingApprovals.find(item => item.email === cleanEmail);
    if (pending) {
        return res.json({ success: true, isApproved: false, status: pending.status });
    }

    return res.json({ success: true, isApproved: false, status: 'NOT_REGISTERED' });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Apex Forex Academy Web Server running on port ${PORT}`);
});
