// Hand-picked, verified product images for the hero products + the most demo-able catalog items. Everything else has no
// imageUrl on purpose — the UI shows a monogram. Owner: A.
// Sources (all checked to serve image/* and to actually show the product):
//   Breville — official product shots from Breville's CDN (product page og:image), resized to 600px.
//   Wikimedia Commons — 500px thumbnails; licenses CC0 / public domain / CC BY 2.0 / CC BY-SA 3.0–4.0 (credit: the
//   file pages on commons.wikimedia.org, linked from each URL's filename). Close-enough generations are noted.
const BREVILLE = "https://assets.breville.com/cdn-cgi/image/width=600,format=auto";
const COMMONS = "https://upload.wikimedia.org/wikipedia/commons";

export const PRODUCT_IMAGES: Readonly<Record<string, string>> = {
  // hero
  prd_bambino: `${BREVILLE}/BES450/BES450BSS1BUS1/pdp.png`,
  prd_iphone17: `${COMMONS}/thumb/5/56/Black_iPhone_17.jpg/500px-Black_iPhone_17.jpg`,
  // coffee & kitchen
  prd_bambino_plus: `${BREVILLE}/BES500/BES500BSS1BUS1/pdp_1300px.png`,
  prd_breville_bes878: `${BREVILLE}/BES878/BES878BSS1BUS1/pdp_1300px.png`,
  prd_breville_bcg820: `${BREVILLE}/BCG820/BCG820BSSXL/pdp_1300px.png`,
  prd_breville_bov900: `${BREVILLE}/BOV900/BOV900BSSUSC/pdp_1300px.png`,
  prd_gaggia_classic: `${COMMONS}/thumb/6/6b/GaggiaCC_Modell_2010-10.JPG/500px-GaggiaCC_Modell_2010-10.JPG`, // Classic (2010) ≈ Classic Pro
  prd_moccamaster_kbgv_select: `${COMMONS}/thumb/6/6a/Moccamaster.JPG/500px-Moccamaster.JPG`,
  prd_chemex_cm_8a: `${COMMONS}/thumb/b/b8/Chemex_Coffeemaker.jpg/500px-Chemex_Coffeemaker.jpg`,
  prd_aeropress_original: `${COMMONS}/thumb/a/a6/Red_AeroPress_with_Accessories.jpg/500px-Red_AeroPress_with_Accessories.jpg`,
  prd_kitchenaid_ksm150ps: `${COMMONS}/thumb/d/d9/White_KitchenAid_mixer_%28KSM150PSWH%29.jpg/500px-White_KitchenAid_mixer_%28KSM150PSWH%29.jpg`,
  prd_instant_pot_duo_6qt: `${COMMONS}/thumb/7/72/Instant_Pot_%2849907000991%29.jpg/500px-Instant_Pot_%2849907000991%29.jpg`,
  prd_lodge_l10sk3: `${COMMONS}/thumb/c/cf/Lodge_skillet.jpg/500px-Lodge_skillet.jpg`,
  // electronics
  prd_apple_airpods_pro_2: `${COMMONS}/thumb/2/2f/AirPods_Pro_%282nd_generation%29.jpg/500px-AirPods_Pro_%282nd_generation%29.jpg`,
  prd_apple_macbook_air_13_m4: `${COMMONS}/thumb/2/25/M2_Macbook_Air_Midnight_model_-_1.jpg/500px-M2_Macbook_Air_Midnight_model_-_1.jpg`, // M2 body = M4 body
  prd_amazon_kindle_paperwhite_2024: `${COMMONS}/thumb/4/43/Amazon_Kindle_Paperwhite_5_Eleventh_Generation_%28C2V2L3%29_6-inch_e-reader.jpg/500px-Amazon_Kindle_Paperwhite_5_Eleventh_Generation_%28C2V2L3%29_6-inch_e-reader.jpg`, // 11th gen
  prd_sony_ps5_slim: `${COMMONS}/4/4b/Playstation_5_mod%C3%A8le_slim_%28%C3%A9dition_standard_avec_lecteur_de_disque_amovible.png`,
  prd_nintendo_switch_2: `${COMMONS}/thumb/4/4e/Nintendo_Switch_2_in_Docking_Console.jpg/500px-Nintendo_Switch_2_in_Docking_Console.jpg`,
  prd_valve_steam_deck_oled_512gb: `${COMMONS}/thumb/a/a7/Steam_Deck_OLED_framsida_hemsk%C3%A4rm.jpg/500px-Steam_Deck_OLED_framsida_hemsk%C3%A4rm.jpg`,
  prd_meta_quest_3_512gb: `${COMMONS}/thumb/9/99/Meta_Quest_3_front_View.jpg/500px-Meta_Quest_3_front_View.jpg`,
  // travel
  prd_hydro_flask_32oz_wide_mouth: `${COMMONS}/thumb/b/be/HydroFlask_Bottle.jpg/500px-HydroFlask_Bottle.jpg`,
};
