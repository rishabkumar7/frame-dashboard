// YouTube channel stats via the YouTube Data API v3.
// Cost per refresh: 3 quota units (channels + playlistItems + videos) out of 10,000/day free.
// Note: the API rounds subscriber counts to 3 significant figures (12,345 → 12,300).

const API = 'https://www.googleapis.com/youtube/v3';
const CACHE_MS = 30 * 60 * 1000;
let memo = { key: '', at: 0, value: null };

export async function getYouTube(env) {
  const handle = normalizeHandle(env.YOUTUBE_HANDLE);
  if (!handle) return { configured: false };
  if (!env.YOUTUBE_API_KEY) return { configured: false, handle };

  if (memo.key === handle && memo.value && Date.now() - memo.at < CACHE_MS) return memo.value;

  const key = env.YOUTUBE_API_KEY;
  const channelRes = await yt(`channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(handle)}`, key);
  const channel = channelRes.items && channelRes.items[0];
  if (!channel) throw new Error(`No channel found for ${handle}`);

  const stats = channel.statistics || {};
  const value = {
    configured: true,
    handle,
    title: channel.snippet.title,
    subscribers: stats.hiddenSubscriberCount ? null : Number(stats.subscriberCount),
    views: Number(stats.viewCount),
    videos: Number(stats.videoCount),
    latest: await getLatestVideo(channel, key).catch((err) => {
      console.error('latest video', err);
      return null;
    }),
  };

  memo = { key: handle, at: Date.now(), value };
  return value;
}

async function getLatestVideo(channel, key) {
  const uploads = channel.contentDetails && channel.contentDetails.relatedPlaylists.uploads;
  if (!uploads) return null;
  const list = await yt(`playlistItems?part=contentDetails&maxResults=1&playlistId=${encodeURIComponent(uploads)}`, key);
  const item = list.items && list.items[0];
  if (!item) return null;
  const id = item.contentDetails.videoId;
  const vids = await yt(`videos?part=snippet,statistics&id=${encodeURIComponent(id)}`, key);
  const v = vids.items && vids.items[0];
  if (!v) return null;
  return {
    id,
    title: v.snippet.title,
    publishedAt: v.snippet.publishedAt,
    views: Number(v.statistics.viewCount || 0),
    likes: v.statistics.likeCount == null ? null : Number(v.statistics.likeCount),
    // Served through the Worker (/api/yt-thumb): the frame only talks to our own server.
    thumbnail: `/api/yt-thumb/${id}`,
  };
}

async function yt(path, key) {
  const res = await fetch(`${API}/${path}&key=${encodeURIComponent(key)}`);
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.error && body.error.message) reason = body.error.message;
    } catch {}
    throw new Error(`YouTube API: ${reason}`);
  }
  return res.json();
}

function normalizeHandle(raw) {
  if (!raw) return '';
  const h = String(raw).trim().replace(/^(https?:\/\/)?(www\.|m\.)?youtube\.com\//i, '').replace(/\/.*$/, '');
  return h.startsWith('@') ? h : `@${h}`;
}

/** Proxies a video thumbnail so the frame doesn't need to trust Google's image CDN itself. */
export async function youtubeThumb(id) {
  if (!/^[\w-]{11}$/.test(id)) return new Response('bad id', { status: 400 });
  const res = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, {
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!res.ok) return new Response('not found', { status: 404 });
  return new Response(res.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' },
  });
}
