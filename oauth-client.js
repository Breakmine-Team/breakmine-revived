/*!
 * Breakmine account sign-in for third-party sites.
 *
 *   <script src="https://api.breakmine.com/oauth/breakmine.js"></script>
 *   <script>
 *     BreakmineAuth.login({ clientId: 'bm_...' })
 *       .then(({ token, username }) => {
 *         // token is the bearer token, username the Breakmine account it belongs to.
 *         fetch('https://example.com/api/me', { headers: { Authorization: 'Bearer ' + token } });
 *       })
 *       .catch((err) => console.warn(err.message));
 *   </script>
 *
 * login() opens the Breakmine consent screen in a popup and resolves once the
 * player approves. It uses PKCE, so no client secret is needed in the page. The
 * page it runs on must be one of the redirect URIs registered for the client
 * (POST /oauth/register), because the popup returns to it.
 *
 * Override the API origin with data-server="https://api.example.com" on the
 * script tag, e.g. when testing against a local server.
 */
(function (global) {
    'use strict';

    var script = global.document && global.document.currentScript;
    var SERVER = '';
    try {
        SERVER = script && script.src ? new URL(script.src).origin : '';
    } catch (err) {
        SERVER = '';
    }
    if (script && script.getAttribute('data-server')) {
        SERVER = String(script.getAttribute('data-server')).replace(/\/+$/, '');
    }
    if (!SERVER) SERVER = 'https://api.breakmine.com';

    var CALLBACK_MESSAGE = 'breakmine:oauth';
    var POPUP_TIMEOUT_MS = 5 * 60 * 1000;

    function base64url(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return global.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function randomString(byteLength) {
        var bytes = new Uint8Array(byteLength);
        global.crypto.getRandomValues(bytes);
        return base64url(bytes);
    }

    function challengeFor(verifier) {
        if (!global.crypto || !global.crypto.subtle) {
            return Promise.reject(new Error('Breakmine sign-in needs a secure (https) page.'));
        }
        return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
            .then(function (digest) { return base64url(new Uint8Array(digest)); });
    }

    function currentPage() {
        return global.location.origin + global.location.pathname;
    }

    function popupFeatures() {
        var width = 440;
        var height = 560;
        var left = Math.max(0, Math.round((global.screen.width - width) / 2));
        var top = Math.max(0, Math.round((global.screen.height - height) / 3));
        return 'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top +
            ',menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes';
    }

    // The popup comes back to this page with ?code=…&state=…. Hand the code to
    // the window that opened it and close; the opener finishes the exchange
    // because it still holds the PKCE verifier.
    function relayCallback() {
        var opener = global.opener;
        if (!opener) return false;

        var params = new URLSearchParams(global.location.search);
        var code = params.get('code');
        var error = params.get('error');
        if (!code && !error) return false;

        opener.postMessage({
            type: CALLBACK_MESSAGE,
            code: code || '',
            state: params.get('state') || '',
            error: error || '',
            errorDescription: params.get('error_description') || '',
        }, '*');

        // Do not leave a usable code sitting in the address bar.
        params.delete('code');
        params.delete('state');
        params.delete('error');
        params.delete('error_description');
        var query = params.toString();
        try {
            global.history.replaceState(null, '', global.location.pathname + (query ? '?' + query : '') + global.location.hash);
        } catch (err) {
            // Some embedded webviews refuse replaceState; closing is enough.
        }

        global.close();
        return true;
    }

    function exchange(clientId, redirectUri, verifier, code) {
        var body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            redirect_uri: redirectUri,
            code: code,
            code_verifier: verifier,
        });

        return global.fetch(SERVER + '/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
                if (!response.ok || !payload.access_token) {
                    throw new Error(payload.error_description || payload.error || 'Breakmine could not sign you in.');
                }
                return {
                    token: payload.access_token,
                    accessToken: payload.access_token,
                    tokenType: payload.token_type || 'Bearer',
                    username: payload.username || '',
                    scope: payload.scope || '',
                    expiresIn: payload.expires_in || 0,
                };
            });
        });
    }

    function login(options) {
        options = options || {};

        var clientId = options.clientId || options.client_id;
        if (!clientId) return Promise.reject(new Error('clientId is required.'));

        var redirectUri = options.redirectUri || options.redirect_uri || currentPage();
        if (!redirectUri) return Promise.reject(new Error('This page cannot be used as a redirect URI; pass redirectUri explicitly.'));
        var scope = options.scope || 'profile';

        var verifier = randomString(32);

        return challengeFor(verifier).then(function (challenge) {
            var state = randomString(16);
            var params = new URLSearchParams({
                client_id: clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: scope,
                state: state,
                code_challenge: challenge,
                code_challenge_method: 'S256',
            });

            var popup = global.open(SERVER + '/oauth/authorize?' + params.toString(), 'breakmine_signin', popupFeatures());
            if (!popup) {
                throw new Error('The sign-in window was blocked. Allow popups for this site and try again.');
            }

            return new Promise(function (resolve, reject) {
                var settled = false;
                var timer = global.setTimeout(function () {
                    finish(new Error('Timed out waiting for the Breakmine sign-in window.'));
                }, POPUP_TIMEOUT_MS);

                function finish(err, value) {
                    if (settled) return;
                    settled = true;
                    global.clearTimeout(timer);
                    if (closedPoll) global.clearInterval(closedPoll);
                    global.removeEventListener('message', onMessage);
                    try { popup.close(); } catch (e) { /* already closed */ }
                    if (err) reject(err); else resolve(value);
                }

                function onMessage(event) {
                    if (event.origin !== SERVER) return;

                    var data = event.data || {};
                    if (data.type !== CALLBACK_MESSAGE) return;
                    if (data.state !== state) return;

                    if (data.error) {
                        var message = data.error === 'access_denied'
                            ? 'Sign-in was cancelled.'
                            : (data.errorDescription || data.error);
                        return finish(new Error(message));
                    }

                    exchange(clientId, redirectUri, verifier, data.code).then(function (result) {
                        finish(null, result);
                    }, finish);
                }

                global.addEventListener('message', onMessage);

                // Closing the popup is a cancel, not a hang until the timeout.
                var closedPoll = global.setInterval(function () {
                    if (popup.closed) finish(new Error('Sign-in was cancelled.'));
                }, 500);
            });
        });
    }

    function user(token) {
        if (!token) return Promise.reject(new Error('A bearer token is required.'));
        return global.fetch(SERVER + '/oauth/userinfo', {
            headers: { Authorization: 'Bearer ' + token },
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (payload) {
                if (!response.ok) throw new Error(payload.error || 'Could not read that account.');
                return payload;
            });
        });
    }

    var relayed = relayCallback();

    global.BreakmineAuth = {
        server: SERVER,
        login: login,
        user: user,
        relayedCallback: relayed,
    };
})(window);
