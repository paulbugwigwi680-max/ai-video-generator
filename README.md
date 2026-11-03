# AI Video Generator

Documentary na video za AI zenye wahusika wasiobadilika.
Stack: Next.js (Vercel) + Supabase + fal.ai + Claude.

## Jinsi uthabiti wa wahusika unavyofanya kazi
1. Claude anaandika script na **character bible** (kila mhusika anaelezwa mara moja, kwa undani, na wote wanatofautiana).
2. Kila mhusika anapata **picha ya rejea** (portrait).
3. Kila shot inapata **picha ya mwanzo (keyframe)** inayotengenezwa kwa kutumia picha za rejea za wahusika waliomo (modeli ya Kontext).
4. Keyframe inageuzwa kuwa **klipu fupi ya video** (image-to-video), kwa hiyo sura haibadiliki.
5. Kazi zote ni **job + webhook**: Vercel haisubiri, fal.ai inaita `/api/webhooks/fal` ikimaliza, Supabase Realtime inasasisha ukurasa.

## Kuanza (kompyuta yako)
```bash
cp .env.example .env.local     # jaza funguo (angalia hapa chini)
npm install
npm run dev
```

## Funguo za `.env.local`
| Kigezo | Kinatoka wapi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | tayari imejazwa kwenye `.env.example` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase > Project Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API (SIRI, usiiweke wazi) |
| `FAL_KEY` | fal.ai > Dashboard > Keys |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `WEBHOOK_SECRET` | `openssl rand -hex 24` |
| `NEXT_PUBLIC_APP_URL` | URL ya Vercel, mfano `https://ai-video-generator.vercel.app` |

**Muhimu:** webhooks za fal.ai haziwezi kufika `localhost`. Kujaribu video kikamilifu, tumia deployment ya Vercel (au tunnel kama ngrok).

## Kupakia GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<JINA-LAKO>/ai-video-generator.git
git push -u origin main
```

## Vercel
1. Vercel > Add New > Project > chagua repo `ai-video-generator`
2. Weka environment variables zote hapo juu
3. Deploy. Kisha weka `NEXT_PUBLIC_APP_URL` iwe URL halisi na ufanye Redeploy

## Supabase
- Authentication > URL Configuration: weka Site URL = URL ya Vercel
- Kujaribu haraka: zima "Confirm email" (Authentication > Sign In / Providers > Email)

## Modeli za fal.ai
IDs za modeli kwenye `.env.example` zinaweza kubadilika. Angalia ukurasa wa kila modeli kwenye fal.ai (jina na vigezo vya input) na ubadilishe `FAL_MODEL_*` kama inahitajika.

## Hatua zinazofuata
- Worker ya FFmpeg (Railway/Render) kuunganisha klipu zote + sauti ya msimulizi + muziki + manukuu
- Sauti ya msimulizi (ElevenLabs)
- Picha nyingi za kila mhusika (pembe tofauti) kwa uthabiti zaidi
- Malipo (Selcom / Flutterwave / M-Pesa) kuongeza credits
- Ukaguzi wa kiotomatiki wa sura (face embedding) na kuzalisha upya shot iliyokengeuka
