'use client';

import { redirect, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { auth, db } from '@/firebase/config';
import { doc, getDoc } from 'firebase/firestore';

export default function Home() {
  const [userType, setUserType] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async user => {
      if (user) {
        const userDocRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(userDocRef);

        if (docSnap.exists()) {
          const fetchedUserType = docSnap.data().userType;
          setUserType(fetchedUserType);

          if (fetchedUserType === 'patient') {
            router.push('/welcome');
          } else if (fetchedUserType === 'doctor') {
            router.push('/welcome');
          }
        } else {
          // If the document doesn't exist, redirect to login or handle accordingly
          router.push('/login');
        }
      } else {
        router.push('/login');
      }
    });

    return () => unsubscribe();
  }, [router]);

  return (
    <div>
      {/* You might want to show a loading indicator here */}
      Loading...
    </div>
  );
}
