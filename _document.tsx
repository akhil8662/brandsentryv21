import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from 'next/document';

interface DocumentProps extends DocumentInitialProps {
  nonce?: string;
}

class MyDocument extends Document<DocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<DocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const rawNonce = ctx.req?.headers['x-nonce'] || ctx.res?.getHeader?.('x-nonce');
    const nonce = Array.isArray(rawNonce) ? rawNonce[0] : rawNonce;
    return { ...initialProps, nonce };
  }

  render() {
    return (
      <Html lang="en">
        <Head nonce={this.props.nonce} />
        <body>
          <Main />
          <NextScript nonce={this.props.nonce} />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
