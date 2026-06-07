import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function run() {
  await addDoc(collection(db, 'messages'), {
    name: 'Auto Test',
    email: 'test@example.com',
    message: 'Test message from script',
    createdAt: new Date()
  });
  console.log("Added test message");
  
  const snap = await getDocs(collection(db, 'messages'));
  console.log("Count: ", snap.docs.length);
  process.exit(0);
}
run();
