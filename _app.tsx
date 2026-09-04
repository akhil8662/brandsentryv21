import App, { type AppProps, type AppContext } from 'next/app';
import Head from 'next/head';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { CartProvider } from '@/contexts/CartContext';
import { ActiveCaseProvider } from '@/contexts/ActiveCaseContext';
import { SectionNavProvider } from '@/contexts/SectionNavContext';
import '@/styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>BrandSentry</title>
        <meta name="description" content="BrandSentry: Enterprise Pharmaceutical Brand Intelligence Platform" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=5" />
      </Head>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CartProvider>
            <ActiveCaseProvider>
              <SectionNavProvider>
                <Component {...pageProps} />
                {/* offset clears the fixed 44px (h-11) app header — without
                    it, a toast's close button can land underneath the
                    header's own bell/cart/user-menu icons and never
                    receive the click. */}
                <Toaster position="top-right" richColors closeButton offset={{ top: '64px' }} />
              </SectionNavProvider>
            </ActiveCaseProvider>
          </CartProvider>
        </AuthProvider>
      </QueryClientProvider>
    </>
  );
}


MyApp.getInitialProps = async (appContext: AppContext) => {
  const appProps = await App.getInitialProps(appContext);
  return { ...appProps };
};
