import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'AiTradr - Fantasy Hockey Trade Analyzer';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          backgroundImage: 'linear-gradient(135deg, #7c3aed 0%, #22c55e 50%, #7c3aed 100%)',
        }}
      >
        {/* Main Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 32,
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 80,
              fontWeight: 'bold',
              color: '#22c55e',
              textShadow: '4px 4px 0px #7c3aed, 8px 8px 0px #000',
              letterSpacing: '0.1em',
              fontFamily: 'monospace',
            }}
          >
            AiTradr
          </div>
          
          {/* Subtitle */}
          <div
            style={{
              fontSize: 36,
              color: '#fff',
              fontFamily: 'monospace',
              textShadow: '2px 2px 0px #000',
            }}
          >
            FANTASY HOCKEY TRADE ANALYZER
          </div>
          
          {/* Brought to you by */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              marginTop: 32,
            }}
          >
            <div
              style={{
                fontSize: 20,
                color: '#fff',
                fontFamily: 'monospace',
              }}
            >
              BROUGHT TO YOU BY
            </div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 'bold',
                color: '#22c55e',
                fontFamily: 'monospace',
                textShadow: '3px 3px 0px #000',
              }}
            >
              THE MOONINITES
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}

