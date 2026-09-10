const { google } = require("googleapis");
const jwt = require("jsonwebtoken");

const SHEET_ID    = "1rY13xKEH9lEiy8Gz9AE8kz8bAVxkOnOqZixdW1tx-9M";
const JWT_SECRET  = process.env.JWT_SECRET || "change-this-secret-in-netlify";

// Cache in memory for 30 minutes to avoid hammering the Sheets API
let cache = { data: null, ts: 0 };
const CACHE_MS = 30 * 60 * 1000;

function verifyToken(event) {
  const auth = event.headers["authorization"] || event.headers["Authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("No token");
  return jwt.verify(token, JWT_SECRET);
}

function getAuth() {
  // Service account credentials stored as a JSON string in env var GOOGLE_SERVICE_ACCOUNT
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || "{}");
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

// Clean a raw cell value to a usable number or string
function cleanNum(v) {
  if (v === null || v === undefined || v === "" || v === "#REF!" || v === "#N/A") return null;
  const s = String(v).replace(/[$,]/g, "").replace(/\(([^)]+)\)/, "-$1");
  const n = parseFloat(s.replace("%", ""));
  if (isNaN(n)) return null;
  // If it was a percentage string > 1.5 keep as-is, if decimal convert
  if (s.includes("%") && n > 1.5) return n;
  if (!s.includes("%") && Math.abs(n) <= 1.5 && n !== 0 && String(v).includes(".")) return null; // likely decimal pct, skip
  return n;
}

function cleanDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  // Try ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Try M/D/YYYY or M/D/YY
  const parts = s.split("/");
  if (parts.length === 3) {
    let [m, d, y] = parts.map(Number);
    if (y < 100) y += 2000;
    if (m && d && y) return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  return null;
}

// Sheet tab definitions — name, header row index (0-based), data starts row, and column mapping
const TABS = [
  {
    name: "2016-2021",
    headerRow: 0,
    dataStart: 1,
    map: {
      market: 0, room: 1, artist: 2, date: 4, dow: 5, genre: 6,
      ticket_high: 7, ticket_low: 8, avg_ticket: 9,
      date_on_sale: 10, days_on_sale: 11,
      headliner_fee: 12, piano: 13, backline: 14, stagehand: 16,
      other_exp: 17, total_exp: 19, production: 21, advertising: 22,
      tix_rev: 24, tix_sold_av: 25,
      mg_rev: 26, mg_tix: 27,
      gross_tix_rev: 43, total_tix_sold: 42,
      comp_tickets: 44, no_show_paid: 45, no_show_comps: 46,
      vinofile_tix: 47, no_show_paid_pct: 48, no_show_comps_pct: 49,
      expected_att: 50, total_no_show: 51, total_no_show_pct: 52,
      actual_att: 53, artist_wine: 54, artist_merch: 55,
      merch_to_cw: 56, merch_cw_pct: 57, processing_fee: 58,
      fb_sales: 59, tax: 60, adjusted_gross: 61, net: 62,
      profit_margin: 63, ppa: 64,
    }
  },
  {
    name: "2023",
    headerRow: 1,
    dataStart: 2,
    map: {
      market: 0, room: 1, artist: 2, date: 3, dow: 4, genre: 5,
      ticket_high: 6, ticket_low: 7, avg_ticket: 8,
      date_on_sale: 9, days_on_sale: 10,
      headliner_fee: 11, buyout: 12, artist_withholding: 13,
      support_fees: 14, piano: 15, backline: 16, stagehand: 17,
      other_exp: 18, total_exp: 20, production: 22, advertising: 23,
      tix_rev: 25, tix_sold_av: 26,
      mg_rev: 27, mg_tix: 28,
      gross_tix_rev: 44, total_tix_sold: 43,
      comp_tickets: 45, no_show_paid: 46, no_show_comps: 47,
      vinofile_tix: 48, no_show_paid_pct: 49, no_show_comps_pct: 50,
      expected_att: 51, total_no_show: 52, total_no_show_pct: 53,
      actual_att: 54, artist_wine: 55, artist_merch: 56,
      merch_to_cw: 57, merch_cw_pct: 58, processing_fee: 60,
      fb_sales: 61, tax: 62, adjusted_gross: 63, net: 64,
      profit_margin: 65, ppa: 66,
    }
  },
  {
    name: "2024",
    headerRow: 1,
    dataStart: 2,
    map: {
      market: 0, room: 1, date: 2, artist: 3, dow: 4, genre: 5,
      ticket_high: 6, ticket_low: 7, avg_ticket: 8,
      date_on_sale: 9, days_on_sale: 10,
      headliner_fee: 11, buyout: 12, artist_withholding: 13,
      support_fees: 14, piano: 15, backline: 16, stagehand: 17,
      other_exp: 18, total_exp: 20, production: 22, advertising: 23,
      tix_rev: 25, tix_sold_av: 26,
      gross_tix_rev: 44, total_tix_sold: 43,
      comp_tickets: 45, no_show_paid: 46, no_show_comps: 47,
      vinofile_tix: 48, no_show_paid_pct: 49, no_show_comps_pct: 50,
      expected_att: 51, total_no_show: 52, total_no_show_pct: 53,
      actual_att: 54, artist_wine: 55, artist_merch: 57,
      merch_to_cw: 58, merch_cw_pct: 59, processing_fee: 61,
      fb_sales: 62, tax: 63, adjusted_gross: 64, net: 65,
      profit_margin: 66, ppa: 67,
    }
  },
  {
    name: "2025",
    headerRow: 0,
    dataStart: 1,
    map: {
      market: 0, room: 1, date: 2, dow: 3, artist: 4, genre: 5,
      headliner_fee: 6, mg_expense: 7, buyout: 8, support_fees: 9,
      piano: 10, backline: 11, stagehand: 12, other_exp: 13, total_exp: 14,
      date_on_sale: 16, days_on_sale: 17,
      ticket_high: 18, ticket_low: 19, avg_ticket: 20,
      tix_rev: 21, gross_tix_rev: 30,
      tax: 31, adjusted_gross: 32, net: 33, profit_margin: 34,
      tix_sold_av: 35, total_tix_sold: 44,
      capacity: 45, pct_capacity: 46,
      expected_att: 47, actual_att: 48, vinofile_tix: 49,
      no_show_paid: 50, no_show_paid_pct: 51,
      comp_tickets: 52, no_show_comps: 53, no_show_comps_pct: 54,
      total_no_show: 55, total_no_show_pct: 56,
      fb_sales: 57, production: 58, advertising: 59,
      processing_fee: 60, ppa: 61, artist_withholding: 62,
      artist_wine: 63, artist_merch: 65,
      merch_to_cw: 66, merch_cw_pct: 67,
    }
  },
  {
    name: "2026",
    headerRow: 1,
    dataStart: 2,
    map: {
      market: 0, room: 1, date: 2, dow: 3, artist: 4, genre: 5,
      headliner_fee: 6, mg_expense: 7, buyout: 8, support_fees: 9,
      piano: 10, backline: 11, stagehand: 12, other_exp: 13, total_exp: 14,
      date_on_sale: 16, days_on_sale: 17,
      ticket_high: 18, ticket_low: 19, avg_ticket: 20,
      tix_rev: 21, gross_tix_rev: 30,
      tax: 31, adjusted_gross: 32, net: 33, profit_margin: 34,
      tix_sold_av: 35, total_tix_sold: 44,
      capacity: 45, pct_capacity: 46,
      expected_att: 47, actual_att: 48, vinofile_tix: 49,
      no_show_paid: 50, no_show_paid_pct: 51,
      comp_tickets: 52, no_show_comps: 53, no_show_comps_pct: 54,
      total_no_show: 55, total_no_show_pct: 56,
      fb_sales: 57, production: 58, advertising: 59,
      processing_fee: 60, ppa: 61, artist_withholding: 62,
      artist_wine: 63, artist_merch: 65,
      merch_to_cw: 66, merch_cw_pct: 67,
    }
  },
];

const MKT_NORMALIZE = {
  "nyc": "New York", "city vineyard": "New York",
  "philadlephia": "Philadelphia", "philadelphia ": "Philadelphia",
  "pittsbugh": "Pittsburgh", "pittsburgh ": "Pittsburgh",
  "nashville ": "Nashville", "chicago ": "Chicago",
  "atlanta ": "Atlanta", "boston ": "Boston",
  "st. louis ": "St. Louis", "dc ": "DC",
  "hudson valley ": "Hudson Valley",
};
const ROOM_NORMALIZE = {
  "main ": "Main", "loft ": "Loft", "the loft": "Loft",
  "haymarket ": "Haymarket", "haymakret": "Haymarket", "hatmarket": "Haymarket",
  "lounge ": "Lounge", "longe": "Lounge",
  "secondary": "Loft", "secondary venue": "Loft",
  "cityvineyard": "Main", "main": "Main",
};

function normalizeMkt(v) {
  if (!v) return null;
  const key = String(v).toLowerCase().trim();
  return MKT_NORMALIZE[key] || String(v).trim();
}
function normalizeRoom(v) {
  if (!v) return null;
  const key = String(v).toLowerCase().trim();
  return ROOM_NORMALIZE[key] || String(v).trim();
}

function isSkipRow(row, mktCol, artCol, dateCol) {
  const mkt = String(row[mktCol] || "").toLowerCase().trim();
  const art = String(row[artCol] || "").toLowerCase().trim();
  const dt  = row[dateCol];
  const SKIP = ["", "market", "location", "city", "average", "total", "totals", "artist", "none"];
  if (SKIP.includes(mkt)) return true;
  if (!art || SKIP.includes(art)) return true;
  if (!dt) return true;
  return false;
}

function parseTab(tab, rawRows) {
  const { map, dataStart } = tab;
  const results = [];

  for (let i = dataStart; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length < 3) continue;

    const mktCol  = map.market ?? 0;
    const artCol  = map.artist ?? 2;
    const dateCol = map.date   ?? (map.date ?? 2);

    if (isSkipRow(row, mktCol, artCol, dateCol)) continue;

    const date = cleanDate(row[map.date]);
    if (!date) continue;

    // Validate year range
    const yr = parseInt(date.slice(0, 4));
    if (yr < 2015 || yr > 2030) continue;

    const r = {
      market:         normalizeMkt(row[map.market]),
      room:           normalizeRoom(row[map.room]),
      date,
      dow:            row[map.dow] ? String(row[map.dow]).trim() : null,
      artist:         row[map.artist] ? String(row[map.artist]).trim() : null,
      genre:          row[map.genre]  ? String(row[map.genre]).trim()  : null,
      avg_ticket:     cleanNum(row[map.avg_ticket]),
      ticket_high:    cleanNum(row[map.ticket_high]),
      ticket_low:     cleanNum(row[map.ticket_low]),
      date_on_sale:   cleanDate(row[map.date_on_sale]),
      days_on_sale:   cleanNum(row[map.days_on_sale]),
      headliner_fee:  cleanNum(row[map.headliner_fee]),
      buyout:         cleanNum(row[map.buyout]),
      support_fees:   cleanNum(row[map.support_fees]),
      total_exp:      cleanNum(row[map.total_exp]),
      gross:          cleanNum(row[map.gross_tix_rev]),
      adjusted_gross: cleanNum(row[map.adjusted_gross]),
      net:            cleanNum(row[map.net]),
      profit_margin:  cleanNum(row[map.profit_margin]),
      total_tix_sold: cleanNum(row[map.total_tix_sold]),
      capacity:       cleanNum(row[map.capacity]),
      pct_capacity:   cleanNum(row[map.pct_capacity]),
      expected_att:   cleanNum(row[map.expected_att]),
      actual_att:     cleanNum(row[map.actual_att]),
      vinofile_tix:   cleanNum(row[map.vinofile_tix]),
      no_show_paid:   cleanNum(row[map.no_show_paid]),
      no_show_paid_pct:  cleanNum(row[map.no_show_paid_pct]),
      comp_tickets:   cleanNum(row[map.comp_tickets]),
      no_show_comps:  cleanNum(row[map.no_show_comps]),
      total_no_show_pct: cleanNum(row[map.total_no_show_pct]),
      fb_sales:       cleanNum(row[map.fb_sales]),
      ppa:            cleanNum(row[map.ppa]),
      production:     cleanNum(row[map.production]),
      advertising:    cleanNum(row[map.advertising]),
      processing_fee: cleanNum(row[map.processing_fee]),
      artist_wine:    cleanNum(row[map.artist_wine]),
      artist_merch:   cleanNum(row[map.artist_merch]),
      merch_to_cw:    cleanNum(row[map.merch_to_cw]),
    };

    // Skip rows with no artist name
    if (!r.artist) continue;

    // Clean genres — remove numeric garbage
    if (r.genre && /^[\d\.\-\s]+$/.test(r.genre)) r.genre = null;

    // Normalize profit margin — if stored as decimal (0.2) convert to percent (20)
    if (r.profit_margin !== null && Math.abs(r.profit_margin) <= 1.5 && r.profit_margin !== 0) {
      r.profit_margin = Math.round(r.profit_margin * 1000) / 10;
    }

    results.push(r);
  }

  return results;
}

async function fetchAllData() {
  const auth  = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const allRows = [];

  for (const tab of TABS) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${tab.name}'!A:CZ`,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      });
      const rawRows = res.data.values || [];
      const parsed  = parseTab(tab, rawRows);
      allRows.push(...parsed);
    } catch (err) {
      console.error(`Error fetching tab ${tab.name}:`, err.message);
    }
  }

  // Sort by date
  allRows.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return allRows;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Verify JWT
  try {
    verifyToken(event);
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  // Return from cache if fresh
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rows: cache.data, count: cache.data.length, cached: true }),
    };
  }

  try {
    const rows = await fetchAllData();
    cache = { data: rows, ts: now };
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rows, count: rows.length, cached: false }),
    };
  } catch (err) {
    console.error("Data fetch error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch data: " + err.message }),
    };
  }
};
