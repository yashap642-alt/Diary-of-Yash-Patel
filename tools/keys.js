#!/usr/bin/env node
/* ============================================================================
   Reel — keys, secrets and hashes.

     node tools/keys.js password "your new password"
     node tools/keys.js secrets            session secret, TOTP secret, recovery codes
     node tools/keys.js totp "ABCD EFGH..."  the six digits right now, to test
     node tools/keys.js verifiers "ID" "password" "PIN"
                                            the old offline verifiers for src/auth.js

   Nothing here writes a secret into the repository. It prints what to paste
   into the host's environment variables, and stops there.
   ==========================================================================*/
'use strict';
const crypto = require('crypto');
const server = require('../api/moments.js');
const A = require('../src/auth.js');

const I = server._internals;

function randomBase32(bytes) {
  const A32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b = crypto.randomBytes(bytes);
  let bits = '';
  for (const byte of b) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += A32[parseInt(bits.slice(i, i + 5), 2)];
  return out.replace(/(.{4})/g, '$1 ').trim();
}
function codeFor(secret, at) {
  return I.totpAt(secret.replace(/\s+/g, ''), Math.floor((at || Date.now()) / 1000 / 30));
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd) {
  console.log(`
  Reel — keys and secrets

    node tools/keys.js password "<your password>"     the hash for REEL_ADMIN_HASH
    node tools/keys.js secrets                        session secret, MFA secret, recovery codes
    node tools/keys.js totp "<secret>"                what your authenticator says right now
    node tools/keys.js verifiers "<ID>" "<pass>" ["<pin>"]
                                                      the offline verifiers for src/auth.js
`);
  process.exit(0);
}

if (cmd === 'password') {
  const pass = rest.join(' ');
  if (pass.length < 12) {
    console.log('\n  A keeper\'s password should be at least 12 characters. Nothing was generated.\n');
    process.exit(1);
  }
  const hash = I.scryptHash(pass);
  console.log(`
  Put this in the host's environment variables (never in the repository):

    REEL_ADMIN_HASH=${hash}

  Vercel:  Project → Settings → Environment Variables → add, then Redeploy.
  Your own machine:  export REEL_ADMIN_HASH='…' before node serve.js.
`);
  process.exit(0);
}

if (cmd === 'secrets') {
  const session = crypto.randomBytes(32).toString('base64url');
  const totp = randomBase32(20);
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 10);
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
  }
  const hashes = codes.map(c => crypto.createHash('sha256').update(c).digest('hex')).join(',');
  console.log(`
  Session secret (REEL_SESSION_SECRET) — anyone holding this can mint cookies,
  so treat it like a password:

    REEL_SESSION_SECRET=${session}

  Second factor (REEL_TOTP_SECRET) — paste this into your authenticator app by
  hand, or as an otpauth link:

    REEL_TOTP_SECRET=${totp.replace(/\s/g, '')}
    otpauth://totp/Reel:YashPatel?secret=${totp.replace(/\s/g, '')}&issuer=Reel&algorithm=SHA1&digits=6&period=30

  Recovery codes (REEL_RECOVERY_CODES, hashes only). Write the ten codes down
  and keep them somewhere safe; each one works once, and only these hashes go
  into the environment:

${codes.map(c => '    ' + c).join('\n')}

    REEL_RECOVERY_CODES=${hashes}

  Signing out everywhere: change REEL_SESSION_EPOCH to any new value (2, 3, …)
  and every cookie ever issued stops working.
`);
  process.exit(0);
}

if (cmd === 'totp') {
  const secret = (rest[0] || '').replace(/\s+/g, '').toUpperCase();
  if (!secret) { console.log('  usage: node tools/keys.js totp "<secret>"'); process.exit(1); }
  console.log('\n  right now: ' + codeFor(secret) + '   (30-second step, next ' + codeFor(secret, Date.now() + 30000) + ')\n');
  process.exit(0);
}

if (cmd === 'verifiers') {
  const [id, pass, pin] = rest;
  if (!id || !pass) { console.log('  usage: node tools/keys.js verifiers "<ID>" "<password>" ["<PIN>"]'); process.exit(1); }
  const saltOf = () => crypto.randomBytes(16).toString('base64');
  const line = (secret, s) => `{ salt: '${s}', hash: '${A._digest(String(secret), s, A.ITER)}' }`;
  const idSalt = saltOf(), passSalt = saltOf(), pinSalt = saltOf();
  console.log(`
  var DEFAULT_VAULT = {
    v: 1, iter: ${A.ITER}, mail: '${A.MAIL}', updated: null, seed: true,
    id:   ${line(id, idSalt)},
    pass: ${line(pass, passSalt)},
    pin:  ${pin ? line(pin, pinSalt) : 'null'}
  };

  /* paste over DEFAULT_VAULT in src/auth.js, then: node build.js
     These are the OFFLINE verifiers. They are not the server's password and
     cannot authorize a write. */
`);
  process.exit(0);
}

console.log('  unknown command: ' + cmd);
process.exit(1);
