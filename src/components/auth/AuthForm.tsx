"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Icons } from "@/components/icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import {auth} from "@/firebase/config";
import {createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile} from "firebase/auth";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { collection, doc, setDoc } from "firebase/firestore";
import { db } from "@/firebase/config";

const formSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  password: z.string().min(6, {
    message: "Password must be at least 6 characters.",
  }),
  username: z.string().optional(),
  userType: z.enum(["patient", "doctor"]).default("patient"),
});

interface AuthFormProps {
  isLogin?: boolean;
}

export function AuthForm({ isLogin }: AuthFormProps) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const router = useRouter();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      username: "",
      userType: "patient",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
          !process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
          !process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
          !process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
          !process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
          !process.env.NEXT_PUBLIC_FIREBASE_APP_ID) {
        throw new Error("Firebase configuration is not properly set in the environment variables.");
      }

      if (isLogin) {
        // Sign in with Firebase
        await signInWithEmailAndPassword(auth, values.email, values.password);
        toast({
          title: "Login Successful",
          description: "Welcome back!",
        });
        router.push("/welcome");
      } else {
        // Sign up with Firebase
        const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
        const user = userCredential.user;

        // Update the user's profile with the username
        if (values.username) {
          await updateProfile(user, {
            displayName: values.username,
          });
        }

        // Store additional user data in Firestore
        const usersCollection = collection(db, 'users');
        const userDocRef = doc(usersCollection, user.uid);
        await setDoc(userDocRef, {
          username: values.username || null,
          email: values.email,
          userType: values.userType,
        });

        toast({
          title: "Signup Successful",
          description: "Please check your email for verification.",
        });
        router.push("/login");
      }
    } catch (error: any) {
      console.error("Authentication error:", error);
      toast({
        title: "Authentication Failed",
        description: error.message || "An error occurred during authentication.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>{isLogin ? "Login" : "Sign Up"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {!isLogin && (
                <>
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter your username" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="userType"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>User Type</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col space-y-1"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="patient" id="patient" />
                              </FormControl>
                              <FormLabel htmlFor="patient">Patient</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl>
                                <RadioGroupItem value="doctor" id="doctor" />
                              </FormControl>
                              <FormLabel htmlFor="doctor">Doctor</FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your email"
                        type="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Enter your password"
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button disabled={isLoading}>
                {isLoading && (
                  <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isLogin ? "Login" : "Sign Up"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      {!isLogin && (
        <p className="mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-primary">
            Login
          </Link>
        </p>
      )}
    </>
  );
}

