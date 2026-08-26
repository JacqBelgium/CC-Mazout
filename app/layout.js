export const metadata = {
  title: "Belgische Mazoutprijzen & Trends",
  description: "Officiële FOD-maximumprijs voor mazout, dagelijks, met markttrend.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
