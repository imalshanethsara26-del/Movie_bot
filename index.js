console.log("🚀 Initializing SARA MOVIE BOT...");

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const cryptoModule = require('crypto');

if (!global.crypto) {
    global.crypto = cryptoModule.webcrypto || cryptoModule;
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');

// Configurations
const PHONE_NUMBER = process.env.PHONE_NUMBER || "94740196225";
const BASE_URL = process.env.BASE_URL || "https://sinhalasubapi-production.up.railway.app";
const TARGET_GROUP_JID = process.env.TARGET_GROUP_JID || "120363410997296034@g.us";
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

const userSessions = {};
let pairingRequested = false;
let reconnecting = false;

process.on('uncaughtException', e => console.error('❌ EX:', e.message || e));
process.on('unhandledRejection', e => console.error('❌ REJ:', e.message || e));

// Helper: Size string එක GB බවට හරවාගැනීම
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

const cleanStorage = () => {
    try {
        fs.readdirSync('./').forEach(f => {
            if (/\.(mp4|mkv|avi|tmp|part|download)$/i.test(f) || f.startsWith('temp_')) {
                try {
                    fs.rmSync(path.join('./', f), { recursive: true, force: true });
                } catch (e) {}
            }
        });
    } catch (e) {}
};

const parseArr = r => {
    const d = r?.data;
    return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.results) ? d.results : [];
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

const downloadFileCurl = async (u, d) => {
    const r = await resolveRealLink(u);
    return new Promise((res, rej) => {
        let f = r.includes('pixeldrain.com/') && !r.includes('/api/file/') ? r.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/') : r;
        exec(`curl -L -s -k --connect-timeout 30 --max-time 600 --retry 3 -A "Mozilla/5.0" "${f}" -o "${d}"`, { maxBuffer: 1024 * 1024 * 1000, timeout: 600000 }, (err) => {
            if (fs.existsSync(d) && fs.statSync(d).size > 1000000) res(true);
            else rej(err || new Error("Download Failed"));
        });
    });
};

async function startBot() {
    cleanStorage();
    try {
        const sessionFolder = './session';
        const credsFile = path.join(sessionFolder, 'creds.json');

        if (fs.existsSync(credsFile)) {
            console.log("🔑 Existing session (creds.json) found! Connecting directly...");
        } else {
            console.log("ℹ️ Session file not found. Will generate Pairing Code...");
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Ubuntu', 'Chrome', '20.0.0.4'],
            markOnlineOnConnect: false,
            mediaUploadTimeoutMs: 900000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async u => {
            const { connection: c, lastDisconnect: l } = u;
            if (c) console.log('🔄 Connection Status:', c);

            if ((c === 'connecting' || !c) && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                console.log('⏳ Requesting Pairing Code...');
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
                console.log('\n✅ SARA MOVIE BOT ONLINE!\n');
            }

            if (c === 'close') {
                const st = l?.error?.output?.statusCode;
                if (st !== DisconnectReason.loggedOut && !reconnecting) {
                    reconnecting = true;
                    setTimeout(() => {
                        pairingRequested = false;
                        reconnecting = false;
                        startBot();
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
                    return sock.sendMessage(from, { text: "📌 *මෙම Chat / Group එකෙහි JID එක:*\n\n`" + from + "`" });
                }

                const isGroupCmd = cmd.toLowerCase().startsWith('.movieg') || cmd.toLowerCase().startsWith('.subg') || cmd.toLowerCase().startsWith('.sinhalasubg') || cmd.toLowerCase().startsWith('.csg');
                const isNormalCmd = cmd.toLowerCase().startsWith('.movie') || cmd.toLowerCase().startsWith('.sub') || cmd.toLowerCase().startsWith('.sinhalasub') || cmd.toLowerCase().startsWith('.cs');

                if (isGroupCmd || isNormalCmd) {
                    const q = cmd.replace(/^\.(movieg|subg|sinhalasubg|csg|movie|sub|sinhalasub|cs)\s*/i, '').trim();
                    if (!q) return sock.sendMessage(from, { text: "🎬 *SARA MOVIE BOT*\n\n📌 *Inbox එකට:* .sub <නම>\n📌 *Group එකට:* .subg <නම>\n\n👤 Created by Imalsha Nethsara" });

                    const sw = await sock.sendMessage(from, { text: "🔎 *SINHALASUB හි සොයමින් පවතී...*" });
                    try {
                        const searchUrl = BASE_URL + "/api/v1/sinhalasub/search?q=" + encodeURIComponent(q);
                        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 60000 });
                        const results = parseArr(res).slice(0, 10);

                        await safeDelete(sock, from, sw.key);

                        if (!results.length) return sock.sendMessage(from, { text: "❌ සෙවුම් ප්‍රතිඵල හමු නොවීය." });

                        userSessions[from] = { type: 'movie_search', results: results, toGroup: isGroupCmd };

                        let list = "🎬 *SARA MOVIE BOT - SINHALASUB*\n\n";
                        results.forEach((item, i) => {
                            list += "*" + (i + 1) + ".* 🎬 " + (item.title || 'Movie') + "\n";
                        });
                        list += "\n📌 *අංකය එවන්න (1-" + results.length + ")*" + (isGroupCmd ? "\n🎯 *ලැබෙන ස්ථානය:* Group එකට" : "") + "\n\n👤 Created by Imalsha Nethsara";

                        await sock.sendMessage(from, { text: list });
                    } catch (err) {
                        await safeDelete(sock, from, sw.key);
                        await sock.sendMessage(from, { text: "⚠️ Search Error! API එක පරීක්ෂා කරන්න." });
                    }
                    return;
                }

                if (/^\d+$/.test(cmd) && userSessions[from]) {
                    const idx = parseInt(cmd, 10) - 1;
                    const session = userSessions[from];

                    if (session.type === 'movie_search') {
                        if (idx < 0 || idx >= session.results.length) return sock.sendMessage(from, { text: "❌ වලංගු අංකයක් තෝරන්න." });

                        const item = session.results[idx];
                        const targetUrl = item.link || item.url;
                        const title = item.title || 'Selected Movie';
                        const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, '').trim();

                        let sendTargetJid = from;
                        if (session.toGroup) {
                            if (TARGET_GROUP_JID && TARGET_GROUP_JID.endsWith('@g.us')) {
                                sendTargetJid = TARGET_GROUP_JID;
                            } else {
                                await sock.sendMessage(from, { text: "⚠️ *Group JID එක සකසා නොමැත!* Inbox එකට යවනු ලැබේ." });
                            }
                        }

                        delete userSessions[from];
                        const stDl = await sock.sendMessage(from, { text: "⚡ *Details පරීක්ෂා කරමින් පවතී...*" });

                        try {
                            const infoUrl = BASE_URL + "/api/v1/sinhalasub/infodl?url=" + encodeURIComponent(targetUrl);
                            const res = await axios.get(infoUrl, { headers: HEADERS, timeout: 90000 });
                            await safeDelete(sock, from, stDl.key);

                            const rData = res?.data?.data || {};
                            const mTitle = (rData.title || title).replace(/Sinhala Subtitles|සිංහල උපසිරැසි|සමඟ/gi, '').trim();
                            const imdbR = rData.imdb_rating || 'N/A';
                            const plot = (rData.story || 'තොරතුරු නොමැත.').replace(/<[^>]*>?/gm, '').trim();
                            const posterUrl = rData.image || item.image;
                            const dList = rData.downloads || [];

                            const vDownloads = dList.filter(i => {
                                const l = (i.link || '').toLowerCase();
                                const q = (i.quality || i.name || '').toLowerCase();
                                return !l.includes('telegram') && !l.includes('t.me') && !q.includes('telegram') && !q.includes('1080') && !q.includes('2160') && !q.includes('4k') && !q.includes('fhd');
                            });

                            if (!vDownloads.length) return sock.sendMessage(from, { text: "⚠️ සුදුසු (720p හෝ 480p) Download link එකක් හමු නොවීය." });

                            // 720p සහ 480p Links සොයාගැනීම
                            const item720 = vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('720'));
                            const item480 = vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('480'));

                            let sObj = null;

                            // 720p තිබේදැයි බලයි. එහි Size එක 2GB ට වඩා වැඩි නම් 480p එකට Switch වේ.
                            if (item720) {
                                const size720 = parseSizeGB(item720.size);
                                if (size720 > 2.0 && item480) {
                                    console.log("⚠️ 720p size (>2GB) exceeds limit. Switching to 480p...");
                                    sObj = item480;
                                } else {
                                    sObj = item720;
                                }
                            } else if (item480) {
                                sObj = item480;
                            } else {
                                sObj = vDownloads[0];
                            }

                            // තෝරාගත් Link එකේ Size එක 2GB පැනලා නම්
                            if (sObj && parseSizeGB(sObj.size) > 2.0) {
                                return sock.sendMessage(from, { text: "⚠️ මෙම Movie එකෙහි 480p/720p දෙකම 2GB සීමාවට වඩා වැඩිය. WhatsApp එකට Upload කළ නොහැක." });
                            }

                            const dlUrl = sObj.link;
                            const lQual = sObj.quality || 'Auto Quality';
                            const fSize = sObj.size || 'N/A';

                            const tMsg = "🎬 *" + mTitle.toUpperCase() + "*\n\n⭐ *IMDb*  •  " + imdbR + "\n🎞️ *Quality*  •  " + lQual + "\n📦 *Size*  •  " + fSize + "\n\n📝 *STORY*\n" + plot + "\n\n━━━━━━━━━━━━━━━━━━\n\n🎞️ *SARA MOVIE BOT*\n👤 *Created by Imalsha Nethsara*";

                            try {
                                if (posterUrl) await sock.sendMessage(sendTargetJid, { image: { url: posterUrl }, caption: tMsg });
                                else await sock.sendMessage(sendTargetJid, { text: tMsg });
                            } catch (e) {
                                sendTargetJid = from;
                                await sock.sendMessage(from, { text: "⚠️ Group එකට Message යැවීමට නොහැකි විය. Inbox එකට යවනු ලැබේ." });
                                if (posterUrl) await sock.sendMessage(from, { image: { url: posterUrl }, caption: tMsg });
                                else await sock.sendMessage(from, { text: tMsg });
                            }

                            if (sendTargetJid !== from) await sock.sendMessage(from, { text: "🚀 *Group එකට Movie එක Download වීම ආරම්භ විය!*" });

                            cleanStorage();
                            const tFolder = "./temp_" + Date.now();
                            if (!fs.existsSync(tFolder)) fs.mkdirSync(tFolder);
                            const tPath = path.join(tFolder, cleanTitle.replace(/\s+/g, '_') + ".mp4");

                            try {
                                await downloadFileCurl(dlUrl, tPath);

                                // ඩවුන්ලෝඩ් වුණු ෆයිල් එකේ ඇත්ත Size එක 2GB (2000MB) පැනලා නම් Cancel කිරීම
                                const actualSizeMB = fs.statSync(tPath).size / (1024 * 1024);
                                if (actualSizeMB > 2000) {
                                    cleanStorage();
                                    return sock.sendMessage(from, { text: "⚠️ Download වුණු File එක 2GB වලට වඩා වැඩි නිසා WhatsApp එකට Upload කළ නොහැක." });
                                }

                                const stUl = await sock.sendMessage(from, { text: "⬆️ *Upload වෙමින් පවතී...*" });

                                const docMsg = "🎬 *MOVIE READY!* 🍿\n\n*" + mTitle + "*\n\n⭐ *IMDb*  " + imdbR + "\n🎞️ *Quality*  " + lQual + "\n📦 *Size*  " + fSize + "\n\n✅ Your movie is ready.\n🎥 Enjoy the movie!\n\n━━━━━━━━━━━━━━━━━━\n\n🤖 *SARA MOVIE BOT*\n👤 *Created by Imalsha Nethsara*";

                                await sock.sendMessage(sendTargetJid, { document: { url: tPath }, fileName: cleanTitle.replace(/\s+/g, '_') + ".mp4", mimetype: 'video/mp4', caption: docMsg });
                                await safeDelete(sock, from, stUl.key);

                                if (sendTargetJid !== from) await sock.sendMessage(from, { text: "✅ *Movie එක සාර්ථකව Group එකට යවන ලදී!*" });
                                cleanStorage();
                            } catch (err) {
                                cleanStorage();
                                await sock.sendMessage(from, { text: "⚠️ Download/Upload Error!" });
                            }
                        } catch (err) {
                            await safeDelete(sock, from, stDl.key);
                            await sock.sendMessage(from, { text: "⚠️ Info Error!" });
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        });
    } catch (e) {
        console.error(e);
    }
}

setInterval(() => {}, 3600000);
startBot();
