import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function run() {
  try {
    const q = collection(db, 'messages');
    const snap = await getDocs(q);
    console.log("Documents found: ", snap.docs.length);
    snap.docs.forEach(d => {
      console.log(d.id, " => ", d.data());
    });
  } catch (e) {
    console.error("ERROR: ", e);
  }
}
run();
