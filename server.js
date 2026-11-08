const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const SOURCES = {
    xoilac: {
        url: "https://tinyurl.com/xoilacz3",
        prefix: "vb_xl_"
    }
};

let cachedChannels = [];
let cachedCatalogs = [];
let lastFetch = 0;
const CACHE_DURATION = 10 * 60 * 1000; // Làm mới dữ liệu 10 phút / lần

// --- BỘ ĐỌC JSON ĐA TẦNG (Tách Provider -> Catalog, Group -> Genre) ---
async function loadData() {
    if (Date.now() - lastFetch < CACHE_DURATION && cachedChannels.length > 0) {
        return;
    }

    try {
        const res = await fetch(SOURCES.xoilac.url);
        const data = await res.json();
        
        let channels = [];
        let catalogs = [];
        
        if (data && data.providers) {
            data.providers.forEach(provider => {
                const catalogId = `${SOURCES.xoilac.prefix}${provider.id}`;
                let genres = new Set();
                
                if (provider.groups) {
                    provider.groups.forEach(group => {
                        const groupName = group.name || "Khác";
                        genres.add(groupName);
                        
                        if (group.channels) {
                            group.channels.forEach(ch => {
                                let streamUrl = "";
                                let reqHeaders = {};
                                
                                // Trích xuất link và header bảo vệ
                                if (ch.sources) {
                                    ch.sources.forEach(src => {
                                        if (src.contents) {
                                            src.contents.forEach(content => {
                                                if (content.streams) {
                                                    content.streams.forEach(stream => {
                                                        if (!streamUrl && stream.remote_data && stream.remote_data.url) {
                                                            streamUrl = stream.remote_data.url;
                                                            if (stream.remote_data.headers) {
                                                                reqHeaders = stream.remote_data.headers;
                                                            }
                                                        }
                                                    });
                                                }
                                            });
                                        }
                                    });
                                }

                                if (streamUrl) {
                                    channels.push({
                                        id: `${SOURCES.xoilac.prefix}${ch.id}`,
                                        catalogId: catalogId, // Gắn kênh này vào đúng Catalog của nó
                                        name: ch.name || "Kênh không tên",
                                        group: groupName,
                                        logo: ch.home_logo || "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/FC_Barcelona_%28crest%29.svg/1024px-FC_Barcelona_%28crest%29.svg.png",
                                        url: streamUrl,
                                        headers: reqHeaders
                                    });
                                }
                            });
                        }
                    });
                }
                
                // Khởi tạo Danh mục (Catalog) cho Stremio từ Provider
                catalogs.push({
                    type: "tv",
                    id: catalogId,
                    name: provider.name ? `📺 ${provider.name}` : "🔴 Trực Tiếp",
                    extra: genres.size > 0 ? [{ name: "genre", isRequired: false, options: [...genres] }] : []
                });
            });
        }
        
        cachedChannels = channels;
        cachedCatalogs = catalogs;
        lastFetch = Date.now();
    } catch (e) {
        console.error("Lỗi đọc JSON:", e);
    }
}

// --- HÀM KHỞI TẠO ADD-ON ---
async function initAddon() {
    // Tải dữ liệu lần đầu để dựng khung xương cho Stremio
    await loadData();

    const manifest = {
        id: "org.viscabarca.m3u",
        version: "1.1.2", // Nâng version
        name: "Visca Barca TV",
        description: "Hệ thống Đa Danh Mục (Thông minh & Gọn gàng)",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        idPrefixes: ["vb_xl_"], 
        // Bơm toàn bộ danh mục tự động nhận diện được vào manifest
        catalogs: cachedCatalogs.length > 0 ? cachedCatalogs : [
            { type: "tv", id: "vb_xl_default", name: "🔴 Trực Tiếp" }
        ]
    };

    const builder = new addonBuilder(manifest);

    // 1. GỬI DANH SÁCH KÊNH CHO TỪNG CATALOG
    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        await loadData(); // Đảm bảo dữ liệu luôn mới
        
        // Lọc ra đúng các kênh thuộc về Catalog (Provider) mà Stremio đang yêu cầu
        let channels = cachedChannels.filter(c => c.catalogId === id);
        
        // Nếu người dùng chọn một nhóm cụ thể trong menu xổ xuống
        if (extra && extra.genre) {
            channels = channels.filter(ch => ch.group === extra.genre);
        }
        
        let metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name,
            description: ch.group ? `Nhóm: ${ch.group}` : "",
            poster: ch.logo,
            posterShape: "square"
        }));
        
        return { metas };
    });

    // 2. CHI TIẾT KÊNH
    builder.defineMetaHandler(async ({ type, id }) => {
        if (type === "tv") {
            await loadData();
            const ch = cachedChannels.find(c => c.id === id);
            if (ch) {
                return {
                    meta: {
                        id: ch.id,
                        type: "tv",
                        name: ch.name,
                        description: ch.group ? `Kênh ${ch.name} thuộc nhóm ${ch.group}.` : "",
                        poster: ch.logo,
                        posterShape: "square",
                        background: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1935&auto=format&fit=crop"
                    }
                };
            }
        }
        return { meta: null };
    });

    // 3. LUỒNG PHÁT (KÈM CHỐNG CHẶN)
    builder.defineStreamHandler(async ({ type, id }) => {
        if (type === "tv") {
            await loadData();
            const ch = cachedChannels.find(c => c.id === id);
            if (ch && ch.url) {
                let streamObj = { 
                    title: `▶ Phát ngay\nChất lượng tự động`, 
                    url: ch.url 
                };
                if (ch.headers && Object.keys(ch.headers).length > 0) {
                    streamObj.behaviorHints = {
                        notWebReady: true,
                        proxyHeaders: { request: ch.headers }
                    };
                }
                return { streams: [streamObj] };
            }
        }
        return { streams: [] };
    });

    serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
}

initAddon();
