const fs = require('fs');
const key = fs.readFileSync('./garments-client-firebase-adminsdk-fbsvc-2eb0d5e650.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)