const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

// --- CẤU HÌNH NGUỒN JSON DUY NHẤT ---
const SOURCES = {
    xoilac: {
        url: "https://tinyurl.com/xoilacz3",
        prefix: "vb_xl_"
    }
};

const caches = {
    xoilac: { data: [], time: 0 }
};
const CACHE_DURATION = 10 * 60 * 1000;

// --- BỘ ĐỌC JSON CHUYÊN DỤNG ---
async function getPlaylist() {
    if (Date.now() - caches.xoilac.time < CACHE_DURATION && caches.xoilac.data.length > 0) {
        return caches.xoilac.data;
    }

    try {
        const res = await fetch(SOURCES.xoilac.url);
        const data = await res.json();
        const channels = [];

        if (data && data.providers) {
            data.providers.forEach(provider => {
                if (provider.groups) {
                    provider.groups.forEach(group => {
                        const groupName = group.name || "Khác";
                        if (group.channels) {
                            group.channels.forEach(ch => {
                                let streamUrl = "";
                                let reqHeaders = {};
                                
                                // Trích xuất link và header bảo vệ từ các lớp JSON
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
            });
        }

        caches.xoilac.data = channels;
        caches.xoilac.time = Date.now();
        return channels;

    } catch (e) {
        console.error("Lỗi đọc file JSON:", e);
        return caches.xoilac.data; 
    }
}

// --- HÀM KHỞI TẠO ADD-ON ---
async function initAddon() {
    const xlData = await getPlaylist();

    // Tự động gom tất cả các nhóm (VTV, SCTV, HTV, Thể Thao...) từ JSON
    const allGroups = [...new Set(xlData.map(c => c.group).filter(Boolean))];

    const manifest = {
        id: "org.viscabarca.m3u",
        version: "1.1.1", // Đã tăng version lên 1.1.1
        name: "Visca Barca TV",
        description: "Hệ thống Trực tiếp & Truyền hình Siêu tốc",
        resources: ["catalog", "meta", "stream"],
        types: ["tv"],
        idPrefixes: ["vb_xl_"], 
        catalogs: [
            {
                type: "tv", id: "vb_all_catalog", name: "🔴 Trực Tiếp",
                extra: [{ name: "genre", isRequired: false, options: allGroups }]
            }
        ]
    };

    const builder = new addonBuilder(manifest);

    builder.defineCatalogHandler(async ({ type, id, extra }) => {
        let channels = [];
        if (type === "tv" && id === "vb_all_catalog") {
            channels = await getPlaylist();
            
            if (extra && extra.genre) {
                channels = channels.filter(ch => ch.group === extra.genre);
            }
        }
        
        let metas = channels.map(ch => ({
            id: ch.id,
            type: "tv",
            name: ch.name || "Kênh Thể Thao",
            description: ch.group ? `Nhóm: ${ch.group}` : "Trực tiếp",
            poster: ch.logo,
            posterShape: "square"
        }));
        
        return { metas: metas };
    });

    builder.defineMetaHandler(async ({ type, id }) => {
        if (type === "tv") {
            const channels = await getPlaylist();
            const ch = channels.find(c => c.id === id);
            if (ch) {
                return {
                    meta: {
                        id: ch.id,
                        type: "tv",
                        name: ch.name || "Kênh Thể Thao",
                        description: ch.group ? `Bạn đang xem kênh ${ch.name} thuộc nhóm ${ch.group}.` : "Nhấn vào luồng phát bên phải để xem.",
                        poster: ch.logo,
                        posterShape: "square",
                        background: "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?q=80&w=1935&auto=format&fit=crop"
                    }
                };
            }
        }
        return { meta: null };
    });

    builder.defineStreamHandler(async ({ type, id }) => {
        if (type === "tv") {
            const channels = await getPlaylist();
            const ch = channels.find(c => c.id === id);
            if (ch && ch.url) {
                let streamObj = { 
                    title: `▶ Phát ngay\nChất lượng tự động`, 
                    url: ch.url 
                };
                
                // Đẩy header bảo vệ (như User-Agent) vào Stremio
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
