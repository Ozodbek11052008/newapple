const { Telegraf, Markup, session } = require('telegraf');
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const config = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    CHANNEL_USERNAME: process.env.CHANNEL_USERNAME,
    CHANNEL_ID: process.env.CHANNEL_ID,
    WEBAPP_URL: process.env.WEBAPP_URL || 'https://sparkling-cajeta-13db38.netlify.app/',
    ADMIN_USERNAME: 'Ozi_coder',
    PORT: process.env.PORT || 3000,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
    PING_INTERVAL: 14 * 60 * 1000 // 14 minutes
};

const bot = new Telegraf(config.BOT_TOKEN);
const activeUsers = new Set();

// Session configuration
bot.use(session({
    defaultSession: () => ({
        waitingForPost: false
    })
}));

// Track active users
bot.use((ctx, next) => {
    if (ctx.from) {
        activeUsers.add(ctx.from.id);
    }
    return next();
});

// Webhook setup for production
if (process.env.NODE_ENV === 'production') {
    app.use(express.json());
    app.use(bot.webhookCallback('/webhook'));
    bot.telegram.setWebhook(`${config.RENDER_EXTERNAL_URL}/webhook`);
}

// Ping service to prevent idle shutdown
function startPingService() {
    if (!config.RENDER_EXTERNAL_URL) return;
    
    setInterval(async () => {
        try {
            await axios.get(config.RENDER_EXTERNAL_URL);
            console.log('🔄 Pinged server to prevent idle shutdown');
        } catch (error) {
            console.error('Ping failed:', error.message);
        }
    }, config.PING_INTERVAL);
}

// Check admin status
function isAdmin(ctx) {
    return ctx.from?.username === config.ADMIN_USERNAME;
}

// Check subscription status
async function isUserSubscribed(userId) {
    try {
        const member = await bot.telegram.getChatMember(config.CHANNEL_ID, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        console.error('Subscription check error:', error);
        return false;
    }
}

// Start command handler
bot.start(async (ctx) => {
    try {
        if (isAdmin(ctx)) {
            await showAdminPanel(ctx);
        } else {
            const isSubscribed = await isUserSubscribed(ctx.from.id);
            if (isSubscribed) {
                await showWebAppButton(ctx);
            } else {
                await showSubscriptionRequest(ctx);
            }
        }
    } catch (error) {
        handleError(ctx, 'Start command', error);
    }
});

// Subscription verification handler
bot.action('verify_subscription', async (ctx) => {
    try {
        await ctx.answerCbQuery('🔍 Checking subscription...');
        const isSubscribed = await isUserSubscribed(ctx.from.id);

        if (isSubscribed) {
            await showWebAppButton(ctx, true);
        } else {
            await showSubscriptionRequest(ctx, true);
        }
    } catch (error) {
        handleError(ctx, 'Subscription verification', error);
    }
});

// Admin panel commands
bot.hears('👥 Obunachilarni korsatish', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        await ctx.reply(`📊 Aktiv Obunachilar: ${activeUsers.size}\n\nUser IDs:\n${Array.from(activeUsers).join('\n')}`);
    } catch (error) {
        handleError(ctx, 'Show users', error);
    }
});

bot.hears('📨 Xabar Yuborish', async (ctx) => {
    if (!isAdmin(ctx)) return;
    try {
        ctx.session.waitingForPost = true;
        await ctx.reply('Please send the content to broadcast (text/photo/video):');
    } catch (error) {
        handleError(ctx, 'Send post', error);
    }
});

// Handle admin broadcasts
bot.on(['text', 'photo', 'video'], async (ctx) => {
    if (!isAdmin(ctx) || !ctx.session.waitingForPost) return;
    
    try {
        ctx.session.waitingForPost = false;
        const totalUsers = activeUsers.size;
        let successCount = 0;
        
        for (const userId of activeUsers) {
            try {
                if (ctx.message.photo) {
                    await ctx.telegram.sendPhoto(
                        userId,
                        ctx.message.photo[0].file_id,
                        { caption: ctx.message.caption || '' }
                    );
                } else if (ctx.message.video) {
                    await ctx.telegram.sendVideo(
                        userId,
                        ctx.message.video.file_id,
                        { caption: ctx.message.caption || '' }
                    );
                } else {
                    await ctx.telegram.sendMessage(userId, ctx.message.text);
                }
                successCount++;
            } catch (error) {
                console.error(`Failed to send to ${userId}:`, error);
                activeUsers.delete(userId);
            }
        }
        
        await ctx.reply(`✅ Successfully sent to ${successCount}/${totalUsers} users`);
    } catch (error) {
        handleError(ctx, 'Broadcast', error);
    }
});

// Helper functions
async function showAdminPanel(ctx) {
    await ctx.reply(
        '👨‍💻 Admin Panel',
        Markup.keyboard([
            ['👥 Obunachilarni korsatish', '📨 Xabar Yuborish'],
            ['🔄 Refresh Stats']
        ]).resize().oneTime()
    );
}

async function showWebAppButton(ctx, isEdit = false) {
    const message = `🎉 <b>Xush kelibsiz, ${ctx.from.first_name}!</b>\n\n` +
                   `Botdan foydalanish uchun @rvzrcdr dan login ma'lumotlarini oling`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp('🌐 Veb Ilovani Ochish', config.WEBAPP_URL)]
    ]);
    
    if (isEdit) {
        await ctx.editMessageText(message, { parse_mode: 'HTML', ...keyboard });
    } else {
        await ctx.replyWithHTML(message, keyboard);
    }
}

async function showSubscriptionRequest(ctx, isEdit = false) {
    const message = `👋 <b>Xush kelibsiz, ${ctx.from.first_name}!</b>\n\n` +
                   `Bizning xizmatlardan foydalanish uchun quyidagi kanalga obuna bo'ling:\n` +
                   `<b>${config.CHANNEL_USERNAME}</b>`;
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.url('📢 Kanalga Qo‘shilish', `https://t.me/${config.CHANNEL_USERNAME.substring(1)}`)],
        [Markup.button.callback('✅ Obuna bo‘ldim', 'verify_subscription')]
    ]);
    
    if (isEdit) {
        await ctx.editMessageText(message, { parse_mode: 'HTML', ...keyboard });
    } else {
        await ctx.replyWithHTML(message, keyboard);
    }
}

function handleError(ctx, context, error) {
    console.error(`Error in ${context}:`, error);
    ctx.reply('⚠️ An error occurred. Please try again later.');
}

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Bot is running');
});

// Start server
app.listen(config.PORT, () => {
    console.log(`🚀 Server running on port ${config.PORT}`);
    startPingService();
    
    if (process.env.NODE_ENV !== 'production') {
        bot.launch()
            .then(() => console.log(`🤖 Bot @${bot.botInfo.username} is running`))
            .catch(err => console.error('Bot launch failed:', err));
    }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));