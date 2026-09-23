console.log("🚀 Initializing SARA MOVIE BOT (Sinhalasub Engine)...");
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const cryptoModule = require('crypto');

if (!global.crypto) global.crypto = cryptoModule.webcrypto || cryptoModule;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');

// Basic Configuration
const PHONE_NUMBER = "94740196225";
const API_KEY = "chama_api_fe659ca0810da5e445fdc359cb562427";
const BASE_URL = "https://api.chamindu.site/api/v1";
const TARGET_GROUP_JID = "120363410997296034@g.us";
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

const userSessions = {};
let pairingRequested = false;
let reconnecting = false;

process.on('uncaughtException', e => console.error('❌ EX:', e.message || e));
process.on('unhandledRejection', e => console.error('❌ REJ:', e.message || e));

// Storage Clean Helper
const cleanStorage = () => {
    try {
        fs.readdirSync('./').forEach(f => {
            if (/\.(mp4|mkv|avi|tmp|part|download)$/i.test(f) || f.startsWith('temp_')) {
                try { fs.rmSync(path.join('./', f), { recursive: true, force: true }); } catch (e) {}
            }
        });
    } catch (e) {}
};

const parseArr = r => {
    const d = r?.data;
    return Array.isArray(d) ? d : Array.isArray(d?.result) ? d.result : Array.isArray(d?.data) ? d.data : Array.isArray(d?.results) ? d.results : [];
};

const parseCast = c => {
    if (!c) return 'N/A';
    if (Array.isArray(c)) {
        return c.map(x => typeof x === 'object' ? (x.name || x.actor || x.character || '') : String(x)).filter(Boolean).slice(0, 8).join(' • ') || "N/A";
    }
    if (typeof c === 'object') {
        return Object.values(c).map(x => typeof x === 'object' ? (x.name || x.actor || '') : String(x)).filter(Boolean).slice(0, 8).join(' • ') || "N/A";
    }
    return String(c);
};

const parseGenre = g => {
    if (!g) return 'N/A';
    if (Array.isArray(g)) return g.map(x => typeof x === 'object' ? (x.name || String(x)) : String(x)).join(' • ');
    return String(g).replace(/,/g, ' • ');
};

const resolveRealLink = async (u, d = 0) => {
    if (d > 5 || !u) return u;
    try {
        if (u.includes('pixeldrain.com/api/file/')) return u;
        if (u.includes('pixeldrain.com/u/')) return u.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/');
        if (u.includes('cdn.sinhalasub.net') || u.includes('ddl.sinhalasub.net')) return u;
        const r = await axios.get(u, { headers: HEADERS, timeout: 20000, maxRedirects: 10 });
        const h = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        const m = h.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|mkv|avi)[^\s"'>]*/i);
        if (m) return m[0];
        const p = h.match(/https?:\/\/pixeldrain\.com\/(?:u|api\/file)\/[a-zA-Z0-9_-]+/i);
        return p ? (p[0].includes('/u/') ? p[0].replace('/u/', 'pixeldrain.com/api/file/') : p[0]) : u;
    } catch (e) { return u; }
};

const safeDelete = async (s, f, k) => {
    if (k) try { await s.sendMessage(f, { delete: k }); } catch (e) {}
};

const downloadFileCurl = async (u, d) => {
    const r = await resolveRealLink(u);
    return new Promise((res, rej) => {
        let f = r.includes('pixeldrain.com/') && !r.includes('/api/file/') ? r.replace('pixeldrain.com/u/', 'pixeldrain.com/api/file/') : r;
        exec('curl -L -s -k --connect-timeout 30 --max-time 600 --retry 3 -A "Mozilla/5.0" "' + f + '" -o "' + d + '"', { maxBuffer: 1024 * 1024 * 1000, timeout: 600000 }, (err) => {
            if (fs.existsSync(d) && fs.statSync(d).size > 1000000) res(true);
            else rej(err || new Error("Download Failed"));
        });
    });
};

async function startBot() {
    cleanStorage();
    try {
        // Reads creds.json automatically inside ./session
        const { state, saveCreds } = await useMultiFileAuthState('./session');

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

            // Trigger pairing code ONLY if session doesn't exist
            if (c === 'connecting' && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true;
                try {
                    await new Promise(r => setTimeout(r, 2500));
                    const n = PHONE_NUMBER.replace(/[^0-9]/g, '');
                    if (n) {
                        let code = await sock.requestPairingCode(n);
                        if (code) console.log('\n🔐 PAIRING CODE: ' + (code.match(/.{1,4}/g)?.join('-') || code) + '\n');
                    }
                } catch (e) { pairingRequested = false; }
            }

            if (c === 'open') {
                reconnecting = false;
                console.log('\n✅ SARA MOVIE BOT ONLINE! (Session Loaded)\n');
            }

            if (c === 'close') {
                const st = l?.error?.output?.statusCode;
                if (st !== DisconnectReason.loggedOut && !reconnecting) {
                    reconnecting = true;
                    setTimeout(() => { pairingRequested = false; reconnecting = false; startBot(); }, 5000);
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

                const isGroupCmd = cmd.toLowerCase().startsWith('.movieg') || cmd.toLowerCase().startsWith('.ssg') || cmd.toLowerCase().startsWith('.sinhalasubg') || cmd.toLowerCase().startsWith('.csg');
                const isNormalCmd = cmd.toLowerCase().startsWith('.movie') || cmd.toLowerCase().startsWith('.ss') || cmd.toLowerCase().startsWith('.sinhalasub') || cmd.toLowerCase().startsWith('.cs');

                if (isGroupCmd || isNormalCmd) {
                    const q = cmd.replace(/^\.(movieg|ssg|sinhalasubg|csg|movie|ss|sinhalasub|cs)\s*/i, '').trim();
                    if (!q) return sock.sendMessage(from, { text: "🎬 *SARA MOVIE BOT*\n\n📌 *Inbox එකට:* .ss <නම>\n📌 *Group එකට:* .ssg <නම>\n\n👤 Created by Imalsha Nethsara" });

                    const sw = await sock.sendMessage(from, { text: "🔎 *SINHALASUB හි සොයමින් පවතී...*" });

                    try {
                        const res = await axios.get(BASE_URL + "/movies/sinhalasub/search", { params: { q: q, api_key: API_KEY }, headers: HEADERS, timeout: 60000 });
                        const results = parseArr(res).slice(0, 10);

                        await safeDelete(sock, from, sw.key);

                        if (!results.length) return sock.sendMessage(from, { text: "❌ සෙවුම් ප්‍රතිඵල හමු නොවීය." });

                        userSessions[from] = { type: 'movie_search', results: results, toGroup: isGroupCmd };

                        let list = "🎬 *SARA MOVIE BOT - SINHALASUB*\n\n";
                        results.forEach((item, i) => {
                            list += "*" + (i + 1) + ".* 🎬 " + (item.title || item.name || 'Movie') + "\n";
                        });
                        list += "\n📌 *අංකය එවන්න (1-" + results.length + ")*" + (isGroupCmd ? "\n🎯 *ලැබෙන ස්ථානය:* Group එකට" : "") + "\n\n👤 Created by Imalsha Nethsara";

                        await sock.sendMessage(from, { text: list });
                    } catch (err) {
                        await safeDelete(sock, from, sw.key);
                        await sock.sendMessage(from, { text: "⚠️ Search Error!" });
                    }
                    return;
                }

                if (/^\d+$/.test(cmd) && userSessions[from]) {
                    const idx = parseInt(cmd, 10) - 1;
                    const session = userSessions[from];

                    if (session.type === 'movie_search') {
                        if (idx < 0 || idx >= session.results.length) return sock.sendMessage(from, { text: "❌ වලංගු අංකයක් තෝරන්න." });

                        const item = session.results[idx];
                        const targetUrl = item.link || item.url || item.href;
                        const title = item.title || item.name || 'Selected Movie';
                        const cleanTitle = title.replace(/[^a-zA-Z0-9 ]/g, '').trim();

                        let sendTargetJid = from;
                        if (session.toGroup) {
                            if (TARGET_GROUP_JID && TARGET_GROUP_JID.endsWith('@g.us')) {
                                sendTargetJid = TARGET_GROUP_JID;
                            } else {
                                await sock.sendMessage(from, { text: "⚠️ *Group JID එක කෝඩ් එකේ සකසා නොමැත!* Inbox එකට යවනු ලැබේ." });
                            }
                        }

                        delete userSessions[from];

                        const stDl = await sock.sendMessage(from, { text: "⚡ *Details පරීක්ෂා කරමින් පවතී...*" });

                        try {
                            const res = await axios.get(BASE_URL + "/movies/sinhalasub/infodl", { params: { q: targetUrl, api_key: API_KEY }, headers: HEADERS, timeout: 90000 });
                            await safeDelete(sock, from, stDl.key);

                            const rData = res?.data?.data || res?.data?.result || res?.data || {};
                            const mTitle = (rData.title || title).replace(/Sinhala Subtitles|සිංහල උපසිරැසි|සමඟ/gi, '').trim();
                            const imdbR = rData.imdb || rData.rating || 'N/A';
                            const genre = parseGenre(rData.genres || rData.genre);
                            const cast = parseCast(rData.cast);
                            const plot = (rData.story || rData.plot || 'තොරතුරු නොමැත.').replace(/<[^>]*>?/gm, '').trim();
                            const posterUrl = rData.image || item.image;
                            const dList = rData.downloads || [];

                            let vDownloads = dList.filter(i => {
                                const l = (i.link || i.url || '').toLowerCase();
                                const q = (i.quality || i.name || '').toLowerCase();
                                return !l.includes('telegram.me') && !l.includes('t.me') && !q.includes('1080');
                            });

                            if (!vDownloads.length) {
                                vDownloads = dList.filter(i => {
                                    const l = (i.link || i.url || '').toLowerCase();
                                    return !l.includes('telegram.me') && !l.includes('t.me');
                                });
                            }

                            if (!vDownloads.length) return sock.sendMessage(from, { text: "⚠️ Download link එකක් හමු නොවීය." });

                            let sObj = vDownloads.find(i => (i.link || '').includes('pixeldrain.com') && (i.quality || i.name || '').toLowerCase().includes('720'))
                                    || vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('720'))
                                    || vDownloads.find(i => (i.link || '').includes('pixeldrain.com') && (i.quality || i.name || '').toLowerCase().includes('480'))
                                    || vDownloads.find(i => (i.quality || i.name || '').toLowerCase().includes('480'))
                                    || vDownloads[0];

                            const dlUrl = sObj.link || sObj.url;
                            const tMsg = "🎬 *" + mTitle.toUpperCase() + "*\n\n⭐ *IMDb*  •  " + imdbR + "\n🎭 *Genre*  •  " + genre + "\n\n👥 *CAST*\n" + cast + "\n\n📝 *STORY*\n" + plot + "\n\n━━━━━━━━━━━━━━━━━━\n\n🎞️ *SARA MOVIE BOT*\n👤 *Created by Imalsha Nethsara*";

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
                                const stUl = await sock.sendMessage(from, { text: "⬆️ *Group එකට Upload වෙමින් පවතී...*" });

                                const docMsg = "🎬 *MOVIE READY!* 🍿\n\n*" + mTitle + "*\n\n⭐ *IMDb*  " + imdbR + "\n🎭  " + genre + "\n\n✅ Your movie is ready.\n🎥 Enjoy the movie!\n\n━━━━━━━━━━━━━━━━━━\n\n🤖 *SARA MOVIE BOT*\n👤 *Created by Imalsha Nethsara*";

                                await sock.sendMessage(sendTargetJid, {
                                    document: { url: tPath },
                                    fileName: cleanTitle.replace(/\s+/g, '_') + ".mp4",
                                    mimetype: 'video/mp4',
                                    caption: docMsg
                                });

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
            } catch (e) { console.error(e); }
        });

    } catch (e) { console.error(e); }
}

setInterval(() => {}, 3600000);
startBot();
