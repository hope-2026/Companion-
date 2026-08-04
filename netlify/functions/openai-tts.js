const crypto = require('crypto');

const ALLOWED_VOICES = new Set([
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'nova',
  'sage',
  'shimmer',
  'verse'
]);

function getPortalPassword() {
  return (process.env.PORTAL_PASSWORD || '').trim();
}

function createPortalToken() {
  const password = getPortalPassword();
  if (!password) return '';
  const secret = process.env.OPENAI_API_KEY || 'tatjana-portal';
  return crypto.createHmac('sha256', secret).update(password).digest('hex');
}

function isAuthorized(event) {
  if (!getPortalPassword()) return true;
  const token = event.headers['x-portal-auth'] || event.headers['X-Portal-Auth'];
  return Boolean(token) && token === createPortalToken();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!isAuthorized(event)) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Portal password required', type: 'portal_auth_required' })
    };
  }

  try {
    const { text, voice } = JSON.parse(event.body || '{}');
    const cleanText = String(text || '').trim();
    const selectedVoice = ALLOWED_VOICES.has(voice) ? voice : 'coral';

    if (!cleanText) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Text fehlt.' })
      };
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
        voice: selectedVoice,
        input: cleanText,
        instructions: 'Sprich natuerliches Deutsch, warm, ruhig und freundschaftlich. Keine Radiowerbung, keine uebertriebene Betonung, keine kuenstliche Theatralik. Setze sinnvolle Pausen und lass Humor leicht und echt klingen.',
        response_format: 'mp3'
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('OpenAI TTS failed:', response.status, detail);
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'OpenAI TTS fehlgeschlagen.' })
      };
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: audioBuffer.toString('base64'),
        contentType: 'audio/mpeg',
        voice: selectedVoice
      })
    };
  } catch (error) {
    console.error('TTS error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'TTS konnte nicht erzeugt werden.', details: error.message })
    };
  }
};
