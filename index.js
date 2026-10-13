console.log("🚀 Initializing SARA MOVIE BOT (CineSubz Exclusive - Smart 720p/480p Priority)...");

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const cryptoModule = require('crypto');

// Auto-install aria2 package if missing in Colab
try {
    execSync('which aria2c || (apt-get update && apt-get install -y aria2)', { stdio: 'ignore' });
    console.log("⚡ Aria2 Fast Downloader is Ready!");
} catch (e) {
    console.log("⚠️ Aria2 check skipped.");
}

if (!global.crypto) {
    global.crypto = cryptoModule.webcrypto || cryptoModule;
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');

// Configurations
const PHONE_NUMBER = process.env.PHONE_NUMBER || "94740196225";
const BASE_URL = process.env.BASE_URL || "https://cinesubzapi-production.up.railway.app";
const TARGET_GROUP_JID = process.env.TARGET_GROUP_JID || "120363410997296034@g.us";
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

const userSessions = {};
let pairingRequested = false;
let reconnecting = false;

process.on('uncaughtException', e => console.error('❌ EXCEPTION:', e.message || e));
process.on('unhandledRejection', e => console.error('❌ REJECTION:', e.message || e));

const parseSizeGB = (sz) => {
    if (!sz) return 0;
    const s = sz.toString().toLowerCase();
    const m = s.match(/([\d\.]+)/);
    if (!m) return 0;
    const val = parseFloat(m[1]);
    if (s.includes('gb') || s.includes('gib')) return val;
    if (s.includes('mb') || s.includes('mib')) return val / 1024;
    return 0;
};

// Advanced Clean Storage Method
const cleanStorage = () => {
    try {
        fs.readdirSync('./').forEach(f => {
            if (/\.(mp4|mkv|avi|tmp|part|download)$/i.test(f) || f.startsWith('temp_')) {
                try {
                    fs.rmSync(path.join('./', f), { recursive: true, force: true });
                } catch (e) {}
            }
        });
        const files = fs.readdirSync(__dirname);
        files.forEach(file => {
            if (file.startsWith('temp_')) {
                try {
                    fs.rmSync(path.join(__dirname, file), { recursive: true, force: true });
                } catch (e) {}
            }
        });
    } catch (e) {}
};

const clearSessionFolder = () => {
    try {
        if (fs.existsSync('./session')) {
            fs.rmSync('./session', { recursive: true, force: true });
            console.log("🧹 Previous session cleared!");
        }
    } catch (e) {}
};

const parseArr = r => {
    const d = r?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    if (Array.isArray(d?.results)) return d.results;
    if (Array.isArray(d?.result)) return d.result;
    if (Array.isArray(r?.result)) return r.result;
    return [];
};

const resolveRealLink = async (u, d = 0) => {
    if (d > 5 || !u) return u;
    try {
        if (u.includes('pixeldrain.com/api/file/')) return u;
        if (u.includes('pixeldrain.com/u/')) return u.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/');

        const r = await axios.get(u, { headers: HEADERS, timeout: 20000, maxRedirects: 10 });
        const h = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        const m = h.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mkv|avi)[^\s"'>]*/i);
        if (m) return m[0];

        const p = h.match(/https?:\/\/pixeldrain\.com\/(?:u|api\/file)\/[a-zA-Z0-9_-]+/i);
        return p ? (p[0].includes('/u/') ? p[0].replace('/u/', '/api/file/') : p[0]) : u;
    } catch (e) {
        return u;
    }
};

const safeDelete = async (s, f, k) => {
    if (k) {
        try {
            await s.sendMessage(f, { delete: k });
        } catch (e) {}
    }
};

const downloadFileFast = async (u, d, sock, inboxJid) => {
    console.log("\n📥 [RESOLVING DIRECT LINK] Target URL:", u);
    const r = await resolveRealLink(u);
    console.log("🔗 [FINAL DOWNLOAD LINK]:", r);

    if (sock && inboxJid) {
        await sock.sendMessage(inboxJid, { text: "📥 *Movie එක Colab සර්වර් එකට Download වීම ආරම්භ විය...*\n\n(High Speed Fast Downloader Active 🚀)" });
    }

    return new Promise((res, rej) => {
        let f = r.includes('pixeldrain.com/') && !r.includes('/api/file/') ? r.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/') : r;
        console.log("🚀 [ARIA2 DOWNLOAD STARTED] Threads: 16\n");

        const dir = path.dirname(d);
        const file = path.basename(d);

        const args = [
            '-x', '16',
            '-s', '16',
            '-j', '16',
            '--min-split-size=1M',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            '--check-certificate=false',
            '--summary-interval=2',
            '-d', dir,
            '-o', file,
            f
        ];

        const child = spawn('aria2c', args);

        child.stdout.on('data', (data) => {
            process.stdout.write("⚡ [PROGRESS] " + data.toString());
        });

        child.stderr.on('data', (data) => {
            process.stderr.write("⚠️ [ARIA2 LOG] " + data.toString());
        });

        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(d) && fs.statSync(d).size > 1000000) {
                const szMB = (fs.statSync(d).size / (1024 * 1024)).toFixed(2);
                console.log(`\n✅ [DOWNLOAD COMPLETE] File Size: ${szMB} MB\n`);
                res(true);
            } else {
                console.error(`\n❌ [ARIA2 ERROR] Code: ${code}`);
                rej(new Error("Download Failed"));
            }
        });
    });
};

async function startBot(isFreshStart = false) {
    cleanStorage();
    if (isFreshStart) clearSessionFolder();

    try {
        const sessionFolder = './session';
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.0.4'],
            markOnlineOnConnect: false,
            mediaUploadTimeoutMs: 1200000,
            connectTimeoutMs: 1200000,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async u => {
            const { connection: c, lastDisconnect: l } = u;
            if (c) console.log('🔄 [BOT STATUS]:', c);

            if ((c === 'connecting' || !c) && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                console.log('⏳ Requesting Fresh Pairing Code...');
                setTimeout(async () => {
                    try {
                        const n = PHONE_NUMBER.replace(/[^0-9]/g, '');
                        if (n) {
                            let code = await sock.requestPairingCode(n);
                            if (code) console.log('\n🔐 CODE: ' + (code.match(/.{1,4}/g)?.join('-') || code) + '\n');
                        }
                    } catch (e) {
                        console.error('❌ Pairing Code Error:', e.message || e);
                        pairingRequested = false;
                    }
                }, 3000);
            }

            if (c === 'open') {
                reconnecting = false;
                console.log('\n✅ SARA MOVIE BOT IS ONLINE (CineSubz Active)!\n');
            }

            if (c === 'close') {
                const st = l?.error?.output?.statusCode;
                if (st === DisconnectReason.loggedOut) {
                    clearSessionFolder();
                }
                if (!reconnecting) {
                    reconnecting = true;
                    setTimeout(() => {
                        pairingRequested = false;
                        reconnecting = false;
                        startBot(false);
                    }, 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async d => {
            try {
                const msg = d.messages[0];
                if (!msg || !msg.message || msg.key.fromMe) return;

                const from = msg.key.remoteJid;
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
                if (!text) return;

                const cmd = text.trim();

                if (cmd.toLowerCase() === '.jid') {
                    return sock.sendMessage(from, { text: "📌 *මෙම Chat / Group එකෙහි JID අංකය:*\n\n`" + from + "`" });
                }

                let isGroupCmd = false;
                let q = '';

                if (/^\.(csg|cinesubzg)\b/i.test(cmd)) {
                    isGroupCmd = true;
                    q = cmd.replace(/^\.(csg|cinesubzg)\s*/i, '').trim();
                } else if (/^\.(cs|cinesubz)\b/i.test(cmd)) {
                    isGroupCmd = false;
                    q = cmd.replace(/^\.(cs|cinesubz)\s*/i, '').trim();
                }

                if (/^\.(csg|cinesubzg|cs|cinesubz)\b/i.test(cmd)) {
                    if (!q) {
                        return sock.sendMessage(from, { 
                            text: "🎬 *SARA MOVIE BOT (CineSubz)*\n\n" +
                                  "📌 *Cinesubz (Inbox):* .cs <නම>\n" +
                                  "📌 *Cinesubz (Group):* .csg <නම>\n\n" +
                                  "👤 Created by Imalsha Nethsara" 
                        });
                    }

                    console.log(`🔎 [SEARCH QUERY]: "${q}" from ${from}`);
                    const sw = await sock.sendMessage(from, { text: `🔎 *[CINESUBZ] හි සොයමින් පවතී...*` });
                    try {
                        const searchUrl = `${BASE_URL}/api/v1/cinesubz/search?q=${encodeURIComponent(q)}`;
                        console.log("🌐 Requesting Search API:", searchUrl);

                        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 60000 });
                        const results = parseArr(res).slice(0, 10);

                        await safeDelete(sock, from, sw.key);

                        if (!results.length) {
                            console.log("❌ Search returned 0 results.");
                            return sock.sendMessage(from, { text: `❌ [CINESUBZ] හි සෙවුම් ප්‍රතිඵල හමු නොවීය.` });
                        }

                        console.log(`✅ Found ${results.length} results.`);
                        userSessions[from] = { 
                            type: 'movie_search', 
                            results: results, 
                            toGroup: isGroupCmd 
                        };

                        let list = `🎬 *SARA MOVIE BOT - CINESUBZ*\n\n`;
                        results.forEach((item, i) => {
                            const title = item.title || item.name || 'Movie';
                            list += `*${i + 1}.* 🎬 ${title}\n`;
                        });
                        list += `\n📌 *අංකය එවන්න (1-${results.length})*` + (isGroupCmd ? "\n🎯 *රැගෙන යන ස්ථානය:* Group එකට" : "") + "\n\n👤 Created by Imalsha Nethsara";

                        await sock.sendMessage(from, { text: list });
                    } catch (err) {
                        console.error("❌ Search API Error:", err.message);
                        await safeDelete(sock, from, sw.key);
                        await sock.sendMessage(from, { text: "⚠️ Search Error! API එක පරීක්ෂා කරන්න." });
                    }
                    return;
                }

                // Selection Response Handler
                if (/^\d+$/.test(cmd) && userSessions[from]) {
                    const idx = parseInt(cmd, 10) - 1;
                    const session = userSessions[from];

                    if (session.type === 'movie_search') {
                        if (idx < 0 || idx >= session.results.length) return sock.sendMessage(from, { text: "❌ වලංගු අංකයක් තෝරන්න." });

                        const item = session.results[idx];
                        const targetUrl = item.link || item.url || item.href;
                        const title = item.title || item.name || 'Selected Movie';
                        const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, '').trim();

                        console.log(`\n📌 [USER SELECTED ITEM ${idx + 1}]: ${title}`);
                        console.log(`🔗 Target URL: ${targetUrl}`);

                        let sendTargetJid = from;
                        if (session.toGroup) {
                            if (TARGET_GROUP_JID && TARGET_GROUP_JID.endsWith('@g.us')) {
                                sendTargetJid = TARGET_GROUP_JID;
                            } else {
                                await sock.sendMessage(from, { text: "⚠️ *Group JID එක සකසා නොමැත!* Inbox එකට යවනු ලැබේ." });
                            }
                        }

                        delete userSessions[from];
                        const stDl = await sock.sendMessage(from, { text: `⚡ *[CINESUBZ] Details පරීක්ෂා කරමින් පවතී...*` });

                        try {
                            const infoUrl = `${BASE_URL}/api/v1/cinesubz/infodl?url=${encodeURIComponent(targetUrl)}`;
                            console.log("🌐 Requesting Info & Download API:", infoUrl);

                            const res = await axios.get(infoUrl, { headers: HEADERS, timeout: 90000 });
                            await safeDelete(sock, from, stDl.key);

                            const rawData = res?.data;
                            const rData = rawData?.data || rawData?.result || rawData || {};

                            const mTitle = (rData.title || title).replace(/Sinhala Subtitles|සිංහල උපසිරැසි|සමඟ|Cinesubz/gi, '').trim();
                            const imdbR = rData.imdb_rating || rData.rating || rData.imdb || 'N/A';
                            const plot = (rData.story || rData.description || rData.plot || 'තොරතුරු නොමැත.').replace(/<[^>]*>?/gm, '').trim();
                            const posterUrl = rData.image || rData.poster || item.image || item.poster;
                            const dList = rData.downloads || rData.download_links || rData.links || [];

                            console.log(`📊 [API RAW DOWNLOAD LINKS COUNT]: ${dList.length}`);
                            dList.forEach((d, i) => console.log(`   Link ${i + 1}: [Quality: ${d.quality || d.name}] -> ${d.link || d.url}`));

                            const vDownloads = dList.filter(i => {
                                const l = (i.link || i.url || i.href || '').toLowerCase();
                                const q = (i.quality || i.name || i.size || '').toLowerCase();
                                return !l.includes('telegram.org') && !q.includes('2160') && !q.includes('4k');
                            });

                            if (!vDownloads.length) {
                                console.log("⚠️ No valid download links found after filtering.");
                                return sock.sendMessage(from, { text: "⚠️ සුදුසු Download link එකක් හමු නොවීය." });
                            }

                            // 🎯 SMART QUALITY PRIORITY: Always try 720p first, if > 2GB or missing, fallback to 480p
                            let item720 = vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('720'));
                            let item480 = vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('480'));
                            let item360 = vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('360'));

                            let sObj = null;

                            if (item720) {
                                const sz720 = parseSizeGB(item720.size || item720.quality);
                                if (sz720 > 2.0) {
                                    console.log(`⚠️ 720p size is greater than 2GB (${sz720}GB). Falling back to 480p...`);
                                    sObj = item480 || item360 || item720;
                                } else {
                                    console.log("🎯 Selected 720p quality.");
                                    sObj = item720;
                                }
                            } else {
                                console.log("⚠️ 720p not found. Falling back to 480p / available quality...");
                                sObj = item480 || item360 || vDownloads[0];
                            }

                            const dlUrl = sObj.link || sObj.url || sObj.href;
                            const lQual = sObj.quality || sObj.name || 'Auto Quality';
                            const fSize = sObj.size || 'N/A';

                            console.log(`🎯 [FINAL CHOSEN QUALITY]: ${lQual}`);
                            console.log(`🔗 [SELECTED DOWNLOAD LINK]: ${dlUrl}`);

                            const tMsg = "🎬 *" + mTitle.toUpperCase() + "*\n\n🌐 *Source*  •  CINESUBZ\n⭐ *IMDb*  •  " + imdbR + "\n🎞️ *Quality*  •  " + lQual + "\n📦 *Size*  •  " + fSize + "\n\n📝 *STORY*\n" + plot + "\n\n━━━━━━━━━━━━━━━━━━\n\n🎞️ *SARA MOVIE BOT*\n👤 *Created by Imalsha Nethsara*";

                            try {
                                if (posterUrl) await sock.sendMessage(sendTargetJid, { image: { url: posterUrl }, caption: tMsg });
                                else await sock.sendMessage(sendTargetJid, { text: tMsg });
                            } catch (e) {
                                sendTargetJid = from;
                                if (posterUrl) await sock.sendMessage(from, { image: { url: posterUrl }, caption: tMsg });
                                else await sock.sendMessage(from, { text: tMsg });
                            }

                            cleanStorage();
                            const tFolder = path.join(__dirname, "temp_" + Date.now());
                            if (!fs.existsSync(tFolder)) fs.mkdirSync(tFolder, { recursive: true });
                            const tPath = path.join(tFolder, cleanTitle.replace(/\s+/g, '_') + ".mp4");

                            try {
                                await downloadFileFast(dlUrl, tPath, sock, from);

                                const actualSizeMB = fs.statSync(tPath).size / (1024 * 1024);
                                console.log(`📦 [ACTUAL DOWNLOADED FILE SIZE]: ${actualSizeMB.toFixed(2)} MB`);

                                if (actualSizeMB > 2000) {
                                    console.log("❌ File exceeds WhatsApp 2GB limit.");
                                    cleanStorage();
                                    return sock.sendMessage(from, { text: "⚠️ මෙම Movie එකෙහි ඩවුන්ලෝඩ් වූ ෆයිල් එක 2GB සීමාව ඉක්මවයි. WhatsApp එකට Upload කළ නොහැක." });
                                }

                                console.log("⬆️ Uploading document to WhatsApp...");
                                const stUl = await sock.sendMessage(from, { text: "⬆️ *WhatsApp එකට Upload වෙමින් පවතී...*" });

                                const docMsg = "🎬 *MOVIE READY!* 🍿\n\n*" + mTitle + "*\n\n🌐 *Source*  CINESUBZ\n⭐ *IMDb*  " + imdbR + "\n🎞️ *Quality*  " + lQual + "\n📦 *Size*  " + actualSizeMB.toFixed(2) + " MB\n\n✅ Enjoy the movie!\n\n━━━━━━━━━━━━━━━━━━\n\n🤖 *SARA MOVIE BOT*\n👤 *Created by Imalsha Nethsara*";

                                await sock.sendMessage(sendTargetJid, { document: { url: tPath }, fileName: cleanTitle.replace(/\s+/g, '_') + ".mp4", mimetype: 'video/mp4', caption: docMsg });
                                console.log("✅ [SUCCESS] Document Upload Complete!");

                                await safeDelete(sock, from, stUl.key);
                                cleanStorage();
                            } catch (err) {
                                console.error("❌ Download/Upload Error:", err.message || err);
                                cleanStorage();
                                await sock.sendMessage(from, { text: "⚠️ Download/Upload හි දෝෂයක් සිදු විය!" });
                            }
                        } catch (err) {
                            console.error("❌ Info API Error:", err.message || err);
                            await safeDelete(sock, from, stDl.key);
                            await sock.sendMessage(from, { text: "⚠️ Info Error! API එක පරීක්ෂා කරන්න." });
                        }
                    }
                }
            } catch (e) {
                console.error("❌ Message Processing Error:", e);
            }
        });
    } catch (e) {
        console.error("❌ Bot Fatal Error:", e);
    }
}

setInterval(() => {}, 3600000);
startBot(true);
