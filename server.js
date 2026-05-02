const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

// Dùng fetch mặc định của Node.js (Yêu cầu Node.js phiên bản 18 trở lên)
// Nếu bạn dùng Node cũ hơn, hãy thêm dòng: const fetch = require("node-fetch");

const manifest = {
    id: "org.viscabarca.livesport",
    version: "1.0.0",
    name: "Visca Barca - Live",
    description: "Trực tiếp bóng đá và các kênh thể thao tổng hợp",
    resources: ["catalog", "meta", "stream"], // Thêm 'meta' để hiển thị trang chi tiết kênh
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

// --- HÀM PHỤ TRỢ: Lấy dữ liệu từ API ---
async function fetchSportData() {
    try {
        const res = await fetch("https://livesport.hailab.cloud");
        return await res.json();
    } catch (e) {
        console.error("Lỗi gọi API:", e);
        return { groups: [] };
    }
}

// --- 1. CATALOG HANDLER (Tạo danh sách kênh ở màn hình chính) ---
builder.defineCatalogHandler(async ({ type, id }) => {
    if (type === "tv" && id === "vb_live_catalog") {
        const data = await fetchSportData();
        let metas = [];

        if (data.groups) {
            data.groups.forEach(group => {
                (group.channels || []).forEach(ch => {
                    // Thêm kênh vào danh sách hiển thị
                    metas.push({
                        id: `vb_${ch.id}`,
                        type: "tv",
                        name: ch.name,
                        description: `Giải đấu / Nhóm: ${group.name}`,
                        poster: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/1024px-FC_Barcelona_%28crest%29.svg.png",
                        posterShape: "square",
                        background: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1935&auto=format&fit=crop"
                    });
                });
            });
        }
        return { metas: metas };
    }
    return { metas: [] };
});

// --- 2. META HANDLER (Hiển thị chi tiết khi click vào 1 kênh) ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (type === "tv" && id.startsWith("vb_")) {
        const channelId = id.replace("vb_", "");
        const data = await fetchSportData();
        
        let meta = null;
        if (data.groups) {
            data.groups.forEach(group => {
                const ch = (group.channels || []).find(c => c.id === channelId);
                if (ch) {
                    meta = {
                        id: id,
                        type: "tv",
                        name: ch.name,
                        description: `Bạn đang xem kênh ${ch.name} thuộc nhóm ${group.name}. Hãy chọn máy chủ phát bên tay phải.`,
                        poster: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/1024px-FC_Barcelona_%28crest%29.svg.png",
                        posterShape: "square",
                        background: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1935&auto=format&fit=crop"
                    };
                }
            });
        }
        return { meta: meta };
    }
    return { meta: null };
});

// --- 3. STREAM HANDLER (Lấy link video .m3u8 để phát) ---
builder.defineStreamHandler(async ({ type, id }) => {
    if (type === "tv" && id.startsWith("vb_")) {
        const channelId = id.replace("vb_", "");
        const data = await fetchSportData();
        let streams = [];

        if (data.groups) {
            data.groups.forEach(group => {
                const ch = (group.channels || []).find(c => c.id === channelId);
                if (ch) {
                    (ch.sources || []).forEach(source => {
                        (source.contents || []).forEach(content => {
                            (content.streams || []).forEach(stream => {
                                (stream.stream_links || []).forEach(link => {
                                    if (link.url && (link.type === 'hls' || link.url.includes('.m3u8'))) {
                                        
                                        // Xử lý Headers (nếu API có yêu cầu User-Agent, Referer...)
                                        let reqHeaders = {};
                                        if (link.request_headers && link.request_headers.length > 0) {
                                            link.request_headers.forEach(h => {
                                                reqHeaders[h.key] = h.value;
                                            });
                                        }

                                        streams.push({
                                            title: `Server: ${link.name || source.source}\n${stream.quality || 'Auto'}`,
                                            url: link.url,
                                            // Chèn Header để vượt rào cản của host stream (nếu có)
                                            behaviorHints: Object.keys(reqHeaders).length > 0 ? {
                                                notWebReady: true,
                                                proxyHeaders: { request: reqHeaders }
                                            } : undefined
                                        });
                                    }
                                });
                            });
                        });
                    });
                }
            });
        }
        return { streams: streams };
    }
    return { streams: [] };
});

// --- KHỞI CHẠY SERVER ---
serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000});
console.log("🔥 Visca Barca Add-on đang chạy tại http://localhost:7000/manifest.json");