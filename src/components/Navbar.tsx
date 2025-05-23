"use client";

import { auth, db } from "@/firebase/config";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { doc, getDoc } from "firebase/firestore";

export const Navbar = () => {
    const router = useRouter();
    const [loggedIn, setLoggedIn] = useState(false);
    const [username, setUsername] = useState<string | null>(null);
    const [userType, setUserType] = useState<string | null>(null);

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async user => {
            setLoggedIn(!!user);
            if (user) {
                setUsername(user.displayName || user.email?.split('@')[0] || 'User');

                // Fetch user type from Firestore
                const userDocRef = doc(db, 'users', user.uid);
                const docSnap = await getDoc(userDocRef);

                if (docSnap.exists()) {
                    setUserType(docSnap.data().userType || null);
                } else {
                    setUserType(null);
                }
            } else {
                setUsername(null);
                setUserType(null);
            }
        });

        return () => unsubscribe();
    }, []);

    const handleLogout = async () => {
        try {
            await signOut(auth);
            router.push('/login');
        } catch (error) {
            console.error("Logout error:", error);
        }
    };

    return (
        <div className="bg-background border-b border-border h-16 flex items-center justify-between px-4">
            <div className="font-bold text-lg">
                Health App {userType && `(${userType})`}
            </div>
            {loggedIn && (
                <div className="flex items-center space-x-2">
                    <Avatar>
                        <AvatarImage src="https://picsum.photos/50/50" alt={username || "User"} />
                        <AvatarFallback>{username?.charAt(0).toUpperCase() || "U"}</AvatarFallback>
                    </Avatar>
                    <span>{username}</span>
                    <Button variant="outline" size="sm" onClick={handleLogout}>
                        Logout
                    </Button>
                </div>
            )}
        </div>
    );
};
