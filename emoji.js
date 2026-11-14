// Nabídka emoji pro ikonu skupiny. Každá položka: emoji a klíčová slova pro hledání
// (bez diakritiky). Emoji vykresluje systém, takže na iPhonu a Macu jsou to Apple emoji.
const RAW = {
  'Lidé': `👥 skupina lide parta tym|👫 par dvojice|👬 kamaradi par|👭 kamaradky par|👨‍👩‍👧 rodina|👨‍👩‍👧‍👦 rodina deti|🧑‍🤝‍🧑 pratele dvojice|🤝 dohoda ruce spoluprace|💑 par laska|💍 svatba prsten|👰 nevesta svatba|🤵 zenich svatba|👶 dite miminko|🧑‍💼 prace kancelar|👷 stavba delnik|🧑‍🍳 kuchar vareni|🧑‍🎓 student skola|🧑‍💻 programator pocitac prace|🙂 usmev|😎 pohoda bryle|🥳 oslava party|❤️ srdce laska|🫶 srdce ruce`,
  'Bydlení': `🏠 dum domov byt|🏡 dum zahrada|🏢 kancelar budova firma|🏘️ domy sousede|🛋️ gauc obyvak byt|🛏️ postel loznice|🚪 dvere byt|🔑 klic byt najem|🧹 uklid koste|🧽 uklid houba|🧺 pradlo|🚿 sprcha koupelna|🛁 vana koupelna|💡 elektrina energie zarovka|🔥 plyn topeni ohen|💧 voda|📶 internet wifi|🛒 nakup kosik|🧾 uctenka ucet|🏗️ stavba rekonstrukce|🛠️ naradi opravy|🪴 kytka rostlina|🐶 pes|🐱 kocka`,
  'Cestování': `✈️ letadlo dovolena cesta|🏖️ plaz more dovolena|🏝️ ostrov dovolena|🏔️ hory|⛰️ hora|🏕️ kemp stan|⛺ stan|🚗 auto|🚙 auto suv|🚐 dodavka karavan|🚌 autobus|🚆 vlak|🚲 kolo|🛵 skutr|⛵ lod plachetnice|🚢 lod|🗺️ mapa vylet|🧳 kufr cestovani|🌍 svet evropa|🌎 svet amerika|🌏 svet asie|🗽 new york amerika|🗼 pariz francie|🏰 hrad zamek|🎿 lyze hory zima|🏂 snowboard|⛷️ lyzar|🌴 palma tropy|🏨 hotel|⛽ benzin pumpa`,
  'Jídlo a pití': `🍽️ jidlo restaurace|🍕 pizza|🍔 burger|🍟 hranolky|🌮 taco mexiko|🍣 sushi|🍜 nudle polevka asie|🍝 testoviny|🥗 salat|🍳 snidane vejce|🥐 croissant snidane|🍰 dort|🍦 zmrzlina|🍫 cokolada|🍻 pivo hospoda|🍺 pivo|🍷 vino|🥂 pripitek sekt oslava|🍸 koktejl drink bar|🥃 whisky panak|☕ kava kafe|🍵 caj|🧃 dzus|🥤 napoj|🧁 muffin|🥩 maso steak gril|🍗 kure|🧀 syr|🍎 jablko ovoce|🥦 zelenina`,
  'Zábava a sport': `🎉 oslava party|🎂 narozeniny dort|🎁 darek|🎈 balonek oslava|🎄 vanoce stromek|🎃 halloween|🎮 hry konzole|🎲 hry kostka deskovky|🎬 film kino|🎵 hudba|🎤 karaoke zpev|🎸 kytara kapela|🎪 cirkus festival|🎟️ vstupenka listek|⚽ fotbal|🏀 basketbal|🎾 tenis padel|🏐 volejbal|🏒 hokej|🏓 pingpong|🏋️ posilovna fitko|🧘 joga|🏊 plavani bazen|🚴 cyklistika kolo|🏃 beh|🥾 turistika hory boty|🎣 rybareni|⛳ golf|🎳 bowling|🧗 lezeni`,
  'Práce a věci': `💼 prace kufrik firma|💰 penize|💸 penize utrata|💳 karta platba|🏦 banka|📈 graf rust|📊 statistika|📝 poznamky kancl|📚 knihy skola|🎓 skola promoce|💻 pocitac notebook|📱 telefon mobil|📷 fotak foto|🎥 kamera video|🖥️ monitor|🖨️ tiskarna|📦 balik krabice|🚀 raketa projekt startup|⚙️ nastaveni|🔧 klic oprava|🧰 naradi|🚑 zdravi sanitka|💊 leky|🛍️ nakupy tasky|👕 obleceni|🧸 hracka dite|🍼 miminko lahev|🐾 zvire mazlicek|⭐ hvezda`,
  'Příroda a symboly': `🌞 slunce leto|🌙 mesic noc|⛄ snehulak zima|❄️ snih zima|🌈 duha|🌊 more vlna|🌲 les strom|🌸 kvet jaro|🍂 podzim listi|⚡ blesk energie|🏆 pohar vitez|🎯 cil terc|🧩 puzzle|🔔 zvonek|✅ hotovo|❗ pozor|♻️ recyklace|🏁 cil`,
  'Vlajky': `🇨🇿 cesko vlajka|🇸🇰 slovensko vlajka|🇪🇺 evropa unie|🇭🇷 chorvatsko|🇮🇹 italie|🇦🇹 rakousko|🇩🇪 nemecko|🇵🇱 polsko|🇪🇸 spanelsko|🇬🇷 recko|🇫🇷 francie|🇬🇧 anglie britanie|🇺🇸 usa amerika`,
};

// [[název kategorie, [[emoji, klíčová slova], …]], …]
export const EMOJI = Object.entries(RAW).map(([name, list]) => [
  name,
  list.split('|').map((item) => {
    const i = item.indexOf(' ');
    return [item.slice(0, i), item.slice(i + 1)];
  }),
]);

// Barvy skupin: [id, název]. Odstíny pro světlý a tmavý režim jsou ve styles.css (.gc-*).
export const COLORS = [
  ['teal', 'Tyrkysová'], ['blue', 'Modrá'], ['indigo', 'Indigo'], ['violet', 'Fialová'], ['pink', 'Růžová'],
  ['red', 'Červená'], ['orange', 'Oranžová'], ['amber', 'Jantarová'], ['green', 'Zelená'], ['slate', 'Šedá'],
];
