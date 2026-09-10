const jwt = require("jsonwebtoken");

// Users are defined in environment variables as:
// USERS=shlomo:password123,rhiannon:password456
// Set these in Netlify → Site Settings → Environment Variables

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-netlify";
const USERS_ENV  = process.env.USERS || "";

function getUsers() {
  const users = {};
  USERS_ENV.split(",").forEach(entry => {
    const [username, password] = entry.trim().split(":");
    if (username && password) users[username.toLowerCase()] = password;
  });
  return users;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { username, password } = body;
  if (!username || !password) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Username and password required" }) };
  }

  const users = getUsers();
  const stored = users[username.toLowerCase()];

  if (!stored || stored !== password) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Invalid username or password" }),
    };
  }

  const token = jwt.sign(
    { username: username.toLowerCase(), role: "user" },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ token, username: username.toLowerCase() }),
  };
};
