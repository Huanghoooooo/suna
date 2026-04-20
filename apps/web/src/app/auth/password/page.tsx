'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, Suspense } from 'react';
import { ConnectingScreen } from '@/components/dashboard/connecting-screen';
import { AlertCircle, ArrowLeft, Lock } from 'lucide-react';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { toast } from '@/lib/toast';

import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { signInWithPassword, signUpWithPassword } from '../actions';
import { useAuth } from '@/components/AuthProvider';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { cn } from '@/lib/utils';

function PasswordAuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get('returnUrl') || searchParams.get('redirect');
  const { user, isLoading } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && user) {
      router.push(returnUrl || '/instances');
    }
  }, [user, isLoading, router, returnUrl]);

  // Don't render form if already authenticated
  if (!isLoading && user) {
    return null;
  }

  const handleAuth = async (prevState: any, formData: FormData) => {
    setErrorMessage(null);
    
    try {
      const result = isSignUp 
        ? await signUpWithPassword(prevState, formData)
        : await signInWithPassword(prevState, formData);

      // If we get here, there was an error (redirect would have happened server-side)
      if (result && typeof result === 'object' && 'message' in result) {
        setErrorMessage(result.message as string);
        toast.error(result.message as string);
        return result;
      }

      // If no error, redirect manually (fallback in case server redirect didn't work)
      const finalReturnUrl = returnUrl || '/instances';
      router.push(finalReturnUrl);
      router.refresh();
    } catch (error: any) {
      // Next.js redirect() throws a special error - this is expected on success
      if (error?.digest?.startsWith('NEXT_REDIRECT')) {
        // Server-side redirect happened, client will follow
        return;
      }
      
      const errorMsg = error?.message || '发生未知错误';
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen w-full">
      <div className="w-full divide-y divide-border">
        <section className="w-full relative overflow-hidden">
          <div className="relative flex flex-col items-center w-full px-6">
            <div className="absolute inset-x-1/4 top-0 h-[600px] md:h-[800px] -z-20 bg-background rounded-b-xl"></div>

            {/* Header content */}
            <div className="relative z-10 pt-24 pb-8 max-w-md mx-auto h-full w-full flex flex-col gap-2 items-center justify-center">
              <div className="absolute top-6 left-6 z-10">
                <Link href="/" className="flex items-center space-x-2">
                  <KortixLogo size={28} />
                </Link>
              </div>

              <Link
                href="/auth"
                className="group border border-border/50 bg-background hover:bg-accent/20 rounded-full text-sm h-8 px-3 flex items-center gap-2 transition-colors duration-200 shadow-sm mb-6"
              >
                <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-muted-foreground text-xs tracking-wide">
                  返回登录
                </span>
              </Link>

              <div className="bg-muted/50 rounded-full p-4 mb-4">
                <Lock className="h-8 w-8 text-muted-foreground" />
              </div>

              {/* Toggle buttons */}
              <div className="flex items-center gap-2 mb-6 bg-muted/30 rounded-full p-1 w-fit">
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(false);
                    setErrorMessage(null);
                  }}
                  className={cn(
                    "px-6 py-2 rounded-full text-sm font-medium transition-colors",
                    !isSignUp
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  登录
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(true);
                    setErrorMessage(null);
                  }}
                  className={cn(
                    "px-6 py-2 rounded-full text-sm font-medium transition-colors",
                    isSignUp
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  注册
                </button>
              </div>

              <h1 className="text-3xl md:text-4xl lg:text-5xl font-medium tracking-tighter text-center text-balance text-primary">
                {isSignUp ? '创建账号' : '登录'}
              </h1>
              <p className="text-base md:text-lg text-center text-muted-foreground font-medium text-balance leading-relaxed tracking-tight mt-2 mb-6">
                {isSignUp
                  ? '输入邮箱和密码以创建账号'
                  : '输入邮箱和密码登录账号'
                }
              </p>
            </div>
          </div>

          {/* Form card */}
          <div className="relative z-10 flex justify-center px-6 pb-24">
            <div className="w-full max-w-md rounded-xl bg-[#F3F4F6] dark:bg-[#F9FAFB]/[0.02] border border-border p-8">
              {errorMessage && (
                <div className="mb-6 p-4 rounded-lg flex items-center gap-3 bg-destructive/10 border border-destructive/20 text-destructive">
                  <AlertCircle className="h-5 w-5 flex-shrink-0 text-destructive" />
                  <span className="text-sm font-medium">{errorMessage}</span>
                </div>
              )}

              <form className="space-y-4">
                <div>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="邮箱地址"
                    className="h-12 rounded-full bg-background border-border"
                    required
                    autoComplete="email"
                  />
                </div>

                <div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="密码"
                    className="h-12 rounded-full bg-background border-border"
                    required
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  />
                </div>

                {isSignUp && (
                  <div>
                    <Input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      placeholder="确认密码"
                      className="h-12 rounded-full bg-background border-border"
                      required
                      autoComplete="new-password"
                    />
                  </div>
                )}

                {returnUrl && (
                  <input type="hidden" name="returnUrl" value={returnUrl} />
                )}
                <input type="hidden" name="origin" value={typeof window !== 'undefined' ? window.location.origin : ''} />

                <div className="space-y-4 pt-4">
                  <SubmitButton
                    formAction={handleAuth}
                    className="w-full h-12 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-md"
                    pendingText={isSignUp ? '创建账号中...' : '登录中...'}
                  >
                    {isSignUp ? '创建账号' : '登录'}
                  </SubmitButton>
                </div>
              </form>

              {!isSignUp && (
                <div className="mt-6 text-center">
                  <Link
                    href="/auth/reset-password"
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
                  >
                    忘记密码？
                  </Link>
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-xs text-center text-muted-foreground">
                  {isSignUp ? (
                    <>
                      已有账号？{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setIsSignUp(false);
                          setErrorMessage(null);
                        }}
                        className="text-primary hover:underline underline-offset-4"
                      >
                        登录
                      </button>
                    </>
                  ) : (
                    <>
                      还没有账号？{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setIsSignUp(true);
                          setErrorMessage(null);
                        }}
                        className="text-primary hover:underline underline-offset-4"
                      >
                        注册
                      </button>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function PasswordAuth() {
  return (
    <Suspense fallback={<ConnectingScreen forceConnecting minimal title="登录中" />}>
      <PasswordAuthContent />
    </Suspense>
  );
}
