const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

// --- CẤU HÌNH CÁC NGUỒN M3U ---
const SOURCES = {
    live: {
        url: "https://raw.githubusercontent.com/t23-02/bongda/refs/heads/main/bongda.m3u",
        prefix: "vb_live_"
    },
    iptv: {
        url: "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/refs/heads/main/vmttv",
        prefix: "vb_iptv_"
    },
    dlhd: {
        url: "https://raw.githubusercontent.com/arquerido/mych/refs/heads/main/dlhd.m3u", // <--- XOÁ DÒNG CHỮ NÀY VÀ DÁN LINK CỦA BẠN VÀO
        prefix: "vb_dlhd_"
    }
};

// Biến lưu trữ cache
const caches = {
    live: { data: [], time: 0 },
    iptv: { data: [], time: 0 },
    dlhd: { data: [], time: 0 }
};
const CACHE_DURATION = 10 * 60 * 1000; // Cache 10 phút

// --- HÀM PHỤ TRỢ: Tải và Đọc file M3U ---
async function getPlaylist(sourceKey) {
    const source = SOURCES[sourceKey];
    
    if (Date.now() - caches[sourceKey].time < CACHE_DURATION && caches[sourceKey].data.length > 0) {
        return caches[sourceKey].data;
    }

    try {
        const res = await fetch(source.url);
        const text = await res.text();
        
        const lines = text.split(/\r?\n/);
        const channels = [];
        let currentChannel = {};
        let index = 0;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            if (line.startsWith('#EXTINF:')) {
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                if (logoMatch) currentChannel.logo = logoMatch[1];

                const groupMatch = line.match(/group-title="([^"]*)"/);
                if (groupMatch) currentChannel.group = groupMatch[1];

                const commaIndex = line.lastIndexOf(',');
                if (commaIndex !== -1) {
                    currentChannel.name = line.substring(commaIndex + 1).trim();
                } else {
                    currentChannel.name = "Kênh không tên";
                }
            } 
            else if (line.startsWith('http://') || line.startsWith('https://')) {
                currentChannel.url = line;
                currentChannel.id = `${source.prefix}${index}`; 
                
                channels.push(currentChannel);
                currentChannel = {}; 
                index++;
            }
        }

        caches[sourceKey].data = channels;
        caches[sourceKey].time = Date.now();
        return channels;

    } catch (e) {
        console.error(`Lỗi đọc file M3U [${sourceKey}]:`, e);
        return caches[sourceKey].data; 
    }
}

// --- HÀM KHỞI TẠO ADD-ON ---
async function initAddon() {
    // 1. Tải dữ liệu để lấy danh sách Nhóm
    const liveData = await getPlaylist('live');
    const iptvData = await getPlaylist('iptv');
    const dlhdData = await getPlaylist('dlhd');

    const liveGroups = [...new Set(liveData.map(c => c.group).filter(Boolean))];
    const iptvGroups = [...new Set(iptvData.map(c => c.group).filter(Boolean))];
    const dlhdGroups = [...new Set(dlhdData.map(c => c.group).filter(Boolean))];

    // 2. Cấu hình Manifest
    const manifest = {
        id: "org.viscabarca.m3u",
        version: "1.0.4",
        name: "Visca Barca TV",
        description: "Trực tiếp bóng đá, IPTV và DLHD",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        idPrefixes: ["vb_live_", "vb_iptv_", "vb_dlhd_"], 
        catalogs: [
            {
                type: "tv", id: "vb_live_catalog", name: "🔴 Trực Tiếp",
                extra: [{ name: "genre", isRequired: false, options: liveGroups }]
            },
            {
                type: "tv", id: "vb_iptv_catalog", name: "⚽ IPTV Sport",
                extra: [{ name: "genre", isRequired: false, options: iptvGroups }]
            },
            {
                type: "tv", id: "vb_dlhd_catalog", name: "📺 DLHD",
                extra: [{ name: "genre", isRequired: false, options: dlhdGroups }]
            }
        ]
    };

    const builder = new addonBuilder(manifest);

    // --- 3. CATALOG HANDLER ---
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        let channels = [];
        if (type === "tv") {
            if (id === "vb_live_catalog") channels = await getPlaylist('live');
            else if (id === "vb_iptv_catalog") channels = await getPlaylist('iptv');
            else if (id === "vb_dlhd_catalog") channels = await getPlaylist('dlhd');
            
            if (extra && extra.genre) {
                channels = channels.filter(ch => ch.group === extra.genre);
            }
        }
        
        let metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name || "Kênh Thể Thao",
            description: ch.group ? `Nhóm: ${ch.group}` : "Trực tiếp",
            poster: ch.logo || "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/1024px-FC_Barcelona_%28crest%29.svg.png",
            posterShape: "square"
        }));
        
        return { metas: metas };
    });

    // --- 4. META HANDLER ---
    builder.defineMetaHandler(async ({ type, id }) => {
        if (type === "tv") {
            let channels = [];
            if (id.startsWith(SOURCES.live.prefix)) channels = await getPlaylist('live');
            else if (id.startsWith(SOURCES.iptv.prefix)) channels = await getPlaylist('iptv');
            else if (id.startsWith(SOURCES.dlhd.prefix)) channels = await getPlaylist('dlhd');

            const ch = channels.find(c => c.id === id);
            if (ch) {
                return {
                    meta: {
                        id: ch.id,
                        type: "tv",
                        name: ch.name || "Kênh Thể Thao",
                        description: ch.group ? `Bạn đang xem kênh ${ch.name} thuộc nhóm ${ch.group}.` : "Nhấn vào luồng phát bên phải để xem.",
                        poster: ch.logo || "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/1024px-FC_Barcelona_%28crest%29.svg.png",
                        posterShape: "square",
                        background: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1935&auto=format&fit=crop"
                    }
                };
            }
        }
        return { meta: null };
    });

    // --- 5. STREAM HANDLER ---
    builder.defineStreamHandler(async ({ type, id }) => {
        if (type === "tv") {
            let channels = [];
            if (id.startsWith(SOURCES.live.prefix)) channels = await getPlaylist('live');
            else if (id.startsWith(SOURCES.iptv.prefix)) channels = await getPlaylist('iptv');
            else if (id.startsWith(SOURCES.dlhd.prefix)) channels = await getPlaylist('dlhd');

            const ch = channels.find(c => c.id === id);
            if (ch && ch.url) {
                return {
                    streams: [{ title: `▶ Phát ngay\nChất lượng tự động`, url: ch.url }]
                };
            }
        }
        return { streams: [] };
    });

    serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
}

initAddon();
