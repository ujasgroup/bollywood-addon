// Bollywood catalog addon for Stremio (Vercel serverless, no dependencies)
const TMDB = "https://api.themoviedb.org/3";
const KEY = process.env.TMDB_KEY;
const IMG = "https://image.tmdb.org/t/p";

const GENRES = {
  Action: 28, Comedy: 35, Drama: 18, Romance: 10749,
  Thriller: 53, Horror: 27, Crime: 80, Family: 10751,
  Animation: 16, History: 36, Mystery: 9648,
  War: 10752, Music: 10402,
};

const manifest = {
  id: "community.bollywood.catalogs",
  version: "1.0.0",
  name: "Bollywood",
  description: "Hindi / Bollywood catalogs. Streams come from your other addons (Torrentio + TorBox).",
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: [
    {
      type: "movie", id: "bollywood-popular", name: "Bollywood - Popular",
      extra: [
        { name: "genre", options: Object.keys(GENRES), isRequired: false },
        { name: "skip", isRequired: false },
      ],
    },
    { type: "movie", id: "bollywood-new", name: "Bollywood - New Releases", extra: [{ name: "skip" }] },
    { type: "movie", id: "bollywood-top", name: "Bollywood - Top Rated", extra: [{ name: "skip" }] },
    { type: "movie", id: "bollywood-search", name: "Bollywood - Search", extra: [{ name: "search", isRequired: true }] },
    { type: "series", id: "hindi-series", name: "Hindi Series - Popular", extra: [{ name: "skip" }] },
  ],
};

async function tmdb(path, params = {}) {
  const url = new URL(TMDB + path);
  url.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  return r.json();
}

// Torrentio needs IMDb IDs, so look each one up
async function toMetas(items, type) {
  const kind = type === "movie" ? "movie" : "tv";
  const metas = await Promise.all(
    items.map(async (it) => {
      try {
        const ext = await tmdb(`/${kind}/${it.id}/external_ids`);
        if (!ext.imdb_id) return null;
        const date = it.release_date || it.first_air_date || "";
        return {
          id: ext.imdb_id,
          type,
          name: it.title || it.name,
          poster: it.poster_path ? `${IMG}/w500${it.poster_path}` : undefined,
          background: it.backdrop_path ? `${IMG}/w1280${it.backdrop_path}` : undefined,
          description: it.overview,
          releaseInfo: date.slice(0, 4),
          imdbRating: it.vote_average ? it.vote_average.toFixed(1) : undefined,
        };
      } catch {
        return null;
      }
    })
  );
  return metas.filter(Boolean);
}

async function getCatalog(type, id, extra) {
  const page = Math.floor((parseInt(extra.skip) || 0) / 20) + 1;
  const today = new Date().toISOString().slice(0, 10);
  const base = { with_original_language: "hi", region: "IN", page, include_adult: "false" };
  let data;

  if (id === "bollywood-popular") {
    const p = { ...base, sort_by: "popularity.desc", "vote_count.gte": 20 };
    if (extra.genre && GENRES[extra.genre]) p.with_genres = GENRES[extra.genre];
    data = await tmdb("/discover/movie", p);
  } else if (id === "bollywood-new") {
    data = await tmdb("/discover/movie", {
      ...base, sort_by: "primary_release_date.desc",
      "primary_release_date.lte": today, "vote_count.gte": 10,
    });
  } else if (id === "bollywood-top") {
    data = await tmdb("/discover/movie", { ...base, sort_by: "vote_average.desc", "vote_count.gte": 300 });
  } else if (id === "bollywood-search" && extra.search) {
    data = await tmdb("/search/movie", { query: extra.search, page: 1 });
    data.results = data.results.filter((m) => m.original_language === "hi");
  } else if (id === "hindi-series") {
    data = await tmdb("/discover/tv", { ...base, sort_by: "popularity.desc", "vote_count.gte": 5 });
  } else {
    return [];
  }
  return toMetas(data.results || [], type);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  const path = req.url.split("?")[0];

  if (path === "/manifest.json") {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify(manifest));
  }

  const m = path.match(/^\/catalog\/(movie|series)\/([^/]+?)(?:\/(.+))?\.json$/);
  if (m) {
    try {
      if (!KEY) throw new Error("TMDB_KEY env variable is missing");
      const extra = Object.fromEntries(new URLSearchParams(m[3] || ""));
      const metas = await getCatalog(m[1], m[2], extra);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
      return res.status(200).send(JSON.stringify({ metas }));
    } catch (e) {
      return res.status(500).json({ metas: [], error: e.message });
    }
  }

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(
    `<h2>Bollywood addon is running</h2><p>Add this to Stremio: <b>/manifest.json</b></p>`
  );
};
