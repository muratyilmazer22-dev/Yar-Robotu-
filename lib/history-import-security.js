async function verifyFirebaseIdToken(idToken) {
  const apiKey = process.env.apiKey;
  if (!apiKey || typeof idToken !== 'string' || idToken.length > 8192) return null;

  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const result = await response.json();
    const userId = result?.users?.[0]?.localId;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

module.exports = { verifyFirebaseIdToken };
