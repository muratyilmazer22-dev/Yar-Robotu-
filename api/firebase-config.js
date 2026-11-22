export default function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Allow", "GET");
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed." });
    return;
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!process.env.apiKey) {
    response.status(503).json({ error: "Firebase Web API key is not configured." });
    return;
  }

  response.status(200).json({
    apiKey: process.env.apiKey,
    authDomain: "gen-lang-client-0654956769.firebaseapp.com",
    projectId: "gen-lang-client-0654956769",
    storageBucket: "gen-lang-client-0654956769.firebasestorage.app",
    messagingSenderId: "674592286028",
    appId: "1:674592286028:web:f3ef104a587403e1099be9"
  });
}
