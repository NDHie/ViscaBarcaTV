const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

// Cấu hình Manifest cho Add-on
const manifest = {
    id: "org.viscabarca.m3u",
    version: "1.0.2", // Nâng phiên bản lên 1.0.2
    name: "Visca Barca - Live",
    description: "Visca Barca TV",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    // Khai báo tiền tố ID cho từng nguồn để Stremio dễ phân biệt
    idPrefixes: ["vb_live_", "vb_iptv_"], 
    catalogs: [
        {
            type: "tv",
            id: "vb_live_catalog",
            name: "🔴 Trực Tiếp" // Đã đổi tên theo ý bạn
        },
        {
            type: "tv",
            id: "vb_iptv_catalog",
            name: "⚽ IPTV Sport" // Thêm danh mục mới
        }
    ]
};

const builder = new addonBuilder(manifest);

// --- CẤU HÌNH CÁC NGUỒN M3U ---
const SOURCES = {
    live: {
        url: "https://raw.githubusercontent.com/t23-02/bongda/refs/heads/main/bongda.m3u",
        prefix: "vb_live_"
    },
    iptv: {
        url: "https://raw.githubusercontent.com/vuminhthanh12/vuminhthanh12/refs/heads/main/vmttv",
        prefix: "vb_iptv_"
    }
};

// Biến lưu trữ cache riêng cho từng nguồn
const caches = {
    live: { data: [], time: 0 },
    iptv: { data: [], time: 0 }
};
const CACHE_DURATION = 10 * 60 * 1000; // Cache 10 phút

// --- HÀM PHỤ TRỢ: Tải và Đọc file M3U tự động ---
async function getPlaylist(sourceKey) {
    const source = SOURCES[sourceKey];
    
    // Nếu dữ liệu mới tải gần đây thì dùng luôn cache
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
                // Tạo ID ghép từ tiền tố của nguồn và số thứ tự
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

// --- 1. CATALOG HANDLER (Hiện danh sách 2 nhóm kênh) ---
builder.defineCatalogHandler(async ({ type, id }) => {
    let channels = [];
    if (type === "tv") {
        if (id === "vb_live_catalog") {
            channels = await getPlaylist('live');
        } else if (id === "vb_iptv_catalog") {
            channels = await getPlaylist('iptv');
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

// --- 2. META HANDLER (Chi tiết kênh) ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === "tv") {
        let channels = [];
        // Xác định xem ID kênh này thuộc nguồn nào để lấy đúng danh sách
        if (id.startsWith(SOURCES.live.prefix)) {
            channels = await getPlaylist('live');
        } else if (id.startsWith(SOURCES.iptv.prefix)) {
            channels = await getPlaylist('iptv');
        }

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

// --- 3. STREAM HANDLER (Phát Video) ---
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "tv") {
        let channels = [];
        if (id.startsWith(SOURCES.live.prefix)) {
            channels = await getPlaylist('live');
        } else if (id.startsWith(SOURCES.iptv.prefix)) {
            channels = await getPlaylist('iptv');
        }

        const ch = channels.find(c => c.id === id);
        if (ch && ch.url) {
            return {
                streams: [
                    {
                        title: `▶ Phát ngay\nChất lượng tự động`,
                        url: ch.url
                    }
                ]
            };
        }
    }
    return { streams: [] };
});

// --- KHỞI CHẠY SERVER ---
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
