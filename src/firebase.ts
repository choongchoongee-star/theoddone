import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCVG2kwKMQAwkwmTBz7697Lb3ac3Td_27Y',
  authDomain: 'the-odd-one-ad498.firebaseapp.com',
  projectId: 'the-odd-one-ad498',
  storageBucket: 'the-odd-one-ad498.firebasestorage.app',
  messagingSenderId: '1066031778604',
  appId: '1:1066031778604:web:76ab74cfa8205373c43a89',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = getFirestore(app);
const RANKED_SCORE_COLLECTION = 'rankedScoresThreeStage';

export interface LeaderboardEntry {
  uid: string;
  displayName: string;
  score: number;
  totalTimeMs: number;
  wrongGuesses: number;
}

export async function ensureAnonymousUser() {
  await setPersistence(auth, browserLocalPersistence);
  if (auth.currentUser?.isAnonymous) return auth.currentUser;
  if (auth.currentUser) await signOut(auth);
  return (await signInAnonymously(auth)).user;
}

export async function submitBestScore(
  user: User,
  displayName: string,
  score: number,
  totalTimeMs: number,
  wrongGuesses: number,
) {
  const scoreRef = doc(db, RANKED_SCORE_COLLECTION, user.uid);
  let improved = false;

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(scoreRef);
    const previous = snapshot.data();
    const previousScore = Number(previous?.score || 0);
    const previousTime = Number(previous?.totalTimeMs || Number.MAX_SAFE_INTEGER);
    improved = !snapshot.exists() || score > previousScore || (score === previousScore && totalTimeMs < previousTime);
    if (!improved) return;

    transaction.set(scoreRef, {
      uid: user.uid,
      displayName: displayName.trim().slice(0, 10),
      score,
      totalTimeMs,
      wrongGuesses,
      completedAt: serverTimestamp(),
    });
  });

  return improved;
}

export async function loadLeaderboard() {
  const snapshot = await getDocs(query(
    collection(db, RANKED_SCORE_COLLECTION),
    orderBy('score', 'desc'),
    orderBy('totalTimeMs', 'asc'),
    limit(10),
  ));

  return snapshot.docs.map(entry => entry.data() as LeaderboardEntry);
}
