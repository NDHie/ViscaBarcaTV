const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

// Cấu hình Manifest cho Add-on
const manifest = {
    id: "org.viscabarca.m3u",
    version: "1.0.1",
    name: "Visca Barca - Live",
    description: "Trực tiếp bóng đá (Nguồn M3U)",
    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    idPrefixes: ["vb_"],
    catalogs: [
        {
            type: "tv",
            id: "vb_live_catalog",
            name: "🔴 Trực tiếp & Kênh"
        }
    ]
};

const builder = new addonBuilder(manifest);

// Biến lưu trữ cache để không phải tải lại file m3u liên tục
let cachedChannels = [];
let lastFetchTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // Cache 10 phút

// --- HÀM PHỤ TRỢ: Tải và Đọc file M3U ---
async function fetchAndParseM3U() {
    // Nếu dữ liệu mới tải gần đây thì dùng luôn cache cho nhanh
    if (Date.now() - lastFetchTime < CACHE_DURATION && cachedChannels.length > 0) {
        return cachedChannels;
    }

    try {
        const url = "https://raw.githubusercontent.com/t23-02/bongda/refs/heads/main/bongda.m3u";
        const res = await fetch(url);
        const text = await res.text();
        
        // Cắt text thành từng dòng để phân tích
        const lines = text.split(/\r?\n/);
        const channels = [];
        let currentChannel = {};
        let index = 0;

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Đọc thông tin kênh (Tên, Logo, Nhóm)
            if (line.startsWith('#EXTINF:')) {
                const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                if (logoMatch) currentChannel.logo = logoMatch[1];

                const groupMatch = line.match(/group-title="([^"]*)"/);
                if (groupMatch) currentChannel.group = groupMatch[1];

                // Tên kênh thường nằm sau dấu phẩy cuối cùng
                const commaIndex = line.lastIndexOf(',');
                if (commaIndex !== -1) {
                    currentChannel.name = line.substring(commaIndex + 1).trim();
                } else {
                    currentChannel.name = "Kênh không tên";
                }
            } 
            // Đọc link video
            else if (line.startsWith('http://') || line.startsWith('https://')) {
                currentChannel.url = line;
                currentChannel.id = `vb_ch_${index}`; // Tạo ID duy nhất cho kênh
                
                channels.push(currentChannel);
                currentChannel = {}; // Reset để đọc kênh tiếp theo
                index++;
            }
        }

        cachedChannels = channels;
        lastFetchTime = Date.now();
        return channels;

    } catch (e) {
        console.error("Lỗi đọc file M3U:", e);
        return cachedChannels; // Lỗi thì trả về dữ liệu cũ
    }
}

// --- 1. CATALOG HANDLER (Hiện danh sách kênh) ---
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === "tv" && id === "vb_live_catalog") {
        const channels = await fetchAndParseM3U();
        let metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name || "Kênh Thể Thao",
            description: ch.group ? `Nhóm: ${ch.group}` : "Trực tiếp bóng đá",
            poster: ch.logo || "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/1024px-FC_Barcelona_%28crest%29.svg.png",
            posterShape: "square"
        }));
        
        return { metas: metas };
    }
    return { metas: [] };
});

// --- 2. META HANDLER (Chi tiết kênh) ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === "tv" && id.startsWith("vb_")) {
        const channels = await fetchAndParseM3U();
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
    if (type === "tv" && id.startsWith("vb_")) {
        const channels = await fetchAndParseM3U();
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
// Dùng port của Render cấp hoặc mặc định 7000
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
