const DEFAULT_GOOGLE_CLIENT_ID = '27587628711-upin8ch154kqrl88k41978q660oc0pbg.apps.googleusercontent.com';

export class GoogleIdentityVerifier {
  constructor({ clientId = process.env.GOOGLE_CLIENT_ID ?? DEFAULT_GOOGLE_CLIENT_ID, fetchImpl = fetch } = {}) {
    this.clientId = clientId;
    this.fetchImpl = fetchImpl;
  }

  async verify(credential) {
    if (!credential || typeof credential !== 'string') {
      const error = new Error('Google credential is required.');
      error.code = 'INVALID_GOOGLE_CREDENTIAL';
      throw error;
    }

    const url = new URL('https://oauth2.googleapis.com/tokeninfo');
    url.searchParams.set('id_token', credential);

    const response = await this.fetchImpl(url);
    if (!response.ok) {
      const error = new Error('Invalid Google credential.');
      error.code = 'INVALID_GOOGLE_CREDENTIAL';
      throw error;
    }

    const payload = await response.json();
    if (
      payload.aud !== this.clientId
      || !payload.sub
      || !payload.email
    ) {
      const error = new Error('Invalid Google account.');
      error.code = 'INVALID_GOOGLE_ACCOUNT';
      throw error;
    }

    return {
      sub: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name ?? payload.email),
      picture: String(payload.picture ?? '')
    };
  }
}
