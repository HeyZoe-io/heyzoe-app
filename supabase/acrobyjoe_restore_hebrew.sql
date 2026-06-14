-- =============================================================================
-- acrobyjoe: restore Hebrew content (reverse of acrobyjoe_translate_to_english.sql)
-- =============================================================================
-- Scope: slug = 'acrobyjoe' ONLY. Snapshot of production Hebrew as of 2026-06-10.
-- Run manually in Supabase Studio → SQL Editor. Do NOT auto-execute from CI.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) businesses — scalar text fields
-- -----------------------------------------------------------------------------
UPDATE public.businesses
SET
  niche = 'אקרו יוגה',
  bot_name = 'זואי',
  welcome_message = E'היי! איזה כיף שהגעת אלינו 🙂\nשמי זואי מ־Acro by Joe,\nסטודיו האקרו יוגה הגדול בעולם\nנשמח מאוד לארח אותך אצלנו!\nכתובתנו היא רוטשילד 122 תל אביב\nכדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?\n1. אקרו יוגה\n2. עמידות ידיים',
  updated_at = now()
WHERE slug = 'acrobyjoe';

-- -----------------------------------------------------------------------------
-- 2) businesses — social_links (full JSONB replace)
-- -----------------------------------------------------------------------------
UPDATE public.businesses
SET
  social_links = $json$
{
  "vibe": ["רוחני"],
  "fact1": "שיעורים לכל הרמות",
  "fact2": "יש לנו הלפרים שמסתובבים ועוזרים לכולם לתרגל בביטחון ובכיף",
  "fact3": "הסטודיו גדול ומרווח",
  "traits": [
    "שיעורים לכל הרמות",
    "יש לנו הלפרים שמסתובבים ועוזרים לכולם לתרגל בביטחון ובכיף",
    "הסטודיו גדול ומרווח",
    "קהילה בינלאומית חזקה, אנשים מדהימים וצבעוניים.",
    "אנחנו שומרים על בטיחות ברמה גבוהה כך שתוכלו לתרגל בלי לחשוש",
    "האימון עובד על כל מרכיבי הכושר - כוח, גמישות, קוארדינציה, באלאנס ועוד..."
  ],
  "address": "רוטשילד 122 תל אביב",
  "tagline": "סטודיו האקרו יוגה הגדול בעולם",
  "instagram": "https://www.instagram.com/acrobyjoe/",
  "arbox_link": "https://acroyoga.web.arboxapp.com/group?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068&allLocations=false",
  "directions": "חניה פנויה בקרבת המקום",
  "objections": [],
  "promotions": "",
  "sales_flow": {
    "cta_body": "מה דעתך להגיע לאימון ניסיון בקרוב? האימון עולה {priceText} שקלים, הוא נמשך {durationText} דקות ובאמת שהולך להיות כיף.",
    "cta_buttons": [
      {
        "id": "cta-trial",
        "kind": "trial",
        "label": "הרשמה לשיעור ניסיון",
        "trial_cta_delivery": "link"
      },
      {
        "id": "cta-schedule",
        "kind": "schedule",
        "label": "צפייה במערכת השעות",
        "schedule_cta_delivery": "link",
        "schedule_cta_image_url": "",
        "schedule_cta_image_type": ""
      },
      {
        "id": "cta-memberships",
        "kind": "memberships",
        "label": "מחירי מנויים",
        "memberships_cta_delivery": "link",
        "memberships_price_range_max": "",
        "memberships_price_range_min": ""
      }
    ],
    "opening_note": "פתיחה ופרטים שחשובים לך לפני שהליד נרשם לשיעור ניסיון. כל תשובה בפלואו נשלחת יחד עם השאלה הבאה וכפתורי בחירה (או רשימה ממוספרת כשיש יותר משלושה אימונים).",
    "cta_course_body": "מה דעתך להצטרף לקורס שלנו? המחיר הוא {price} שקלים, הוא נמשך כ-{sessions} מפגשים, ובאמת שהולך להיות כיף! התאריכים: {start_date} עד {end_date}",
    "cta_extra_steps": [],
    "greeting_closer": "נשמח מאוד לארח אותך אצלנו!",
    "greeting_opener": "היי! איזה כיף שהגעת אלינו 🙂",
    "after_experience": "נהדר, אנחנו שמחים לקבל מתרגלים מנוסים לסטודיו שלנו, יש לנו מורים מהשורה הראשונה.",
    "cta_workshop_body": "מה דעתך על הסדנה שלנו? המחיר הוא {price} שקלים, היא נמשכת {duration} דקות, ובאמת שהולך להיות כיף!",
    "after_service_pick": "כלל מערכת: [מילת פתיחה]! [קידומת/שם] [הם/היא] + תיאור מטאב אימון ניסיון (טקסט כפי שנשמר ללא עריכה).",
    "cta_course_buttons": [
      {
        "id": "cta-course-enroll",
        "kind": "course_enroll",
        "label": "הצטרפות לקורס",
        "secondary_purchase_delivery": "link"
      },
      {
        "id": "cta-course-contact",
        "kind": "course_contact",
        "label": "יצירת קשר"
      }
    ],
    "experience_options": [
      "כוח וחיטוב",
      "הפחתת כאבים",
      "הפגת מתחים",
      "פאן וגיוון באימונים"
    ],
    "experience_replies": [
      "מושלם. הגעת למקום הנכון. יש לנו אימונים שמתמקדים בחיזוק וחיטוב הגוף כך שתרגישו ותיראו וואו.",
      "מעולה, יש לנו אימונים שמתמקדים בהפחתת הכאב תוך חיזוק והגמשת הגוף.",
      "נהדר. האימונים שלנו יאפשרו לך לקחת פסק זמן מהכל, לצאת מהמירוץ ולהתמסר לגוף ולנפש.",
      "איזה כיף! הגעת למקום הנכון. האימונים שלנו מלאים במלא פאן ואדרנלין כך שתמיד תהיה לכם סיבה טובה להגיע."
    ],
    "greeting_line_name": "שמי {botName} מ־{businessName},",
    "experience_question": "מה בא לך להשיג באימונים אצלנו?",
    "opening_extra_steps": [],
    "cta_workshop_buttons": [
      {
        "id": "cta-workshop-buy",
        "kind": "workshop_purchase",
        "label": "רכישת סדנה",
        "secondary_purchase_delivery": "link"
      },
      {
        "id": "cta-workshop-contact",
        "kind": "workshop_contact",
        "label": "יצירת קשר"
      }
    ],
    "greeting_extra_steps": [],
    "greeting_line_tagline": "{tagline}",
    "free_chat_invite_reply": "אין בעיה! כתבו בטקסט חופשי ואענה 🙂",
    "multi_service_question": "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?",
    "after_course_cycle_pick": "מעולה! רשמנו שתרצו להתחיל את {serviceName} בתאריך {requested_date}.",
    "after_experience_course": "מגניב לגמרי, קורס {serviceName} יאפשר לך לבנות יסודות חזקים ולרכוש מיומנויות חדשות.",
    "cta_body_after_schedule": "עכשיו רק נותר לשריין את מקומך באמצעות תשלום על האימון ניסיון. האימון עולה {priceText} שקלים, הוא נמשך {durationText} דקות ובאמת שהולך להיות כיף. שנתקדם?",
    "show_memberships_button": true,
    "after_schedule_selection": "מהמם! נדאג לשבץ אותך למועד שבחרת!",
    "after_experience_workshop": "איזה כיף לשמוע, סדנת {serviceName} היא בדיוק המקום לזה.",
    "experience_options_course": [
      "כוח וחיטוב",
      "הפחתת כאבים",
      "הפגת מתחים",
      "פאן וגיוון באימונים"
    ],
    "experience_replies_course": [
      "מושלם. הגעת למקום הנכון. יש לנו אימונים שמתמקדים בחיזוק וחיטוב הגוף כך שתרגישו ותיראו וואו.",
      "מעולה, יש לנו אימונים שמתמקדים בהפחתת הכאב תוך חיזוק והגמשת הגוף.",
      "נהדר. האימונים שלנו יאפשרו לך לקחת פסק זמן מהכל, לצאת מהמירוץ ולהתמסר לגוף ולנפש.",
      "איזה כיף! הגעת למקום הנכון. האימונים שלנו מלאים במלא פאן ואדרנלין כך שתמיד תהיה לכם סיבה טובה להגיע."
    ],
    "course_cycle_pick_question": "מתי נוח לך להתחיל את הקורס?",
    "experience_question_course": "מה בא לך להשיג באימונים אצלנו?",
    "opening_extra_steps_course": [],
    "experience_options_workshop": [
      "כוח וחיטוב",
      "הפחתת כאבים",
      "הפגת מתחים",
      "פאן וגיוון באימונים"
    ],
    "experience_replies_workshop": [
      "מושלם. הגעת למקום הנכון. יש לנו אימונים שמתמקדים בחיזוק וחיטוב הגוף כך שתרגישו ותיראו וואו.",
      "מעולה, יש לנו אימונים שמתמקדים בהפחתת הכאב תוך חיזוק והגמשת הגוף.",
      "נהדר. האימונים שלנו יאפשרו לך לקחת פסק זמן מהכל, לצאת מהמירוץ ולהתמסר לגוף ולנפש.",
      "איזה כיף! הגעת למקום הנכון. האימונים שלנו מלאים במלא פאן ואדרנלין כך שתמיד תהיה לכם סיבה טובה להגיע."
    ],
    "experience_question_workshop": "מה בא לך להשיג באימונים אצלנו?",
    "opening_extra_steps_workshop": [],
    "after_trial_registration_body": "כל הכבוד! נרשמת בהצלחה 🎉\n\nמתרגשים לראותך בקרוב!\nזה קורה בכתובת: {business_address}\n\nככה מגיעים אלינו:\n{business_directions}\n\nמומלץ להגיע לאימון לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!\nסופר מחכים לראותך. נתראה בקרוב!\n\n{instagram_cta}",
    "after_course_registration_body": "כל הכבוד! נרשמת בהצלחה 🎉\n\nמתרגשים לראותך בקרוב בקורס!\nזה קורה בכתובת: {business_address}\n\nככה מגיעים אלינו:\n{business_directions}\n\nמומלץ להגיע לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!\nסופר מחכים לראותך. נתראה בקרוב!\n\n{instagram_cta}",
    "followup_after_next_class_body": "שנשריין לך את האימון? 🙂",
    "after_workshop_registration_body": "כל הכבוד! נרשמת בהצלחה 🎉\n\nמתרגשים לראותך בקרוב בסדנה!\nזה קורה בכתובת: {business_address}\n\nככה מגיעים אלינו:\n{business_directions}\n\nמומלץ להגיע לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!\nסופר מחכים לראותך. נתראה בקרוב!\n\n{instagram_cta}",
    "after_schedule_selection_workshop": "מהמם! נשמנו לשבץ אותך לסדנת {serviceName} ביום {requested_date} בשעה {requested_time}.",
    "followup_after_next_class_options": [
      "הרשמה לשיעור ניסיון",
      "צפייה במערכת השעות",
      "מחירי מנויים"
    ],
    "after_trial_registration_body_after_schedule": "כל הכבוד! נרשמת בהצלחה 🎉\n\nמתרגשים לראותך בקרוב ב{serviceName} בתאריך {requested_date} בשעה {requested_time}\nזה קורה בכתובת: {business_address}\n\nככה מגיעים אלינו:\n{business_directions}\n\nמומלץ להגיע לאימון לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!\nסופר מחכים לראותך. נתראה בקרוב!\n\n{instagram_cta}",
    "after_course_registration_body_after_schedule": "כל הכבוד! נרשמת בהצלחה 🎉\n\nמתרגשים לראותך בקרוב ב{serviceName} — התחלה ב-{requested_date}{course_schedule}\nזה קורה בכתובת: {business_address}\n\nככה מגיעים אלינו:\n{business_directions}\n\nמומלץ להגיע לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!\nסופר מחכים לראותך. נתראה בקרוב!\n\n{instagram_cta}",
    "after_workshop_registration_body_after_schedule": "כל הכבוד! נרשמת בהצלחה 🎉\n\nמתרגשים לראותך בקרוב בסדנת {serviceName} בתאריך {requested_date} בשעה {requested_time}\nזה קורה בכתובת: {business_address}\n\nככה מגיעים אלינו:\n{business_directions}\n\nמומלץ להגיע לפחות 10 דקות לפני, עם בקבוק מים ומגבת אישית!\nסופר מחכים לראותך. נתראה בקרוב!\n\n{instagram_cta}"
  },
  "punch_cards": [],
  "website_url": "https://acrobyjoe.com/",
  "quick_replies": [],
  "welcome_intro": "היי! איזה כיף שהגעת אלינו 🙂\nשמי זואי מ־Acro by Joe,\nסטודיו האקרו יוגה הגדול בעולם\nנשמח מאוד לארח אותך אצלנו!\nכתובתנו היא רוטשילד 122 תל אביב",
  "memberships_url": "https://acroyoga.web.arboxapp.com/membership?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068&allLocations=false",
  "welcome_options": [
    "אקרו יוגה",
    "עמידות ידיים"
  ],
  "membership_tiers": [],
  "welcome_question": "כדי שאוכל להתאים עבורך בול את מה שמעניין אותך,\nאיזה אימון הכי קורץ לך?",
  "opening_media_url": "https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1776698799942-_______.mp4",
  "sales_flow_blocks": [],
  "opening_media_type": "video",
  "schedule_public_url": "",
  "wa_sales_followup_1": "היי! 😊 רציתי לוודא שהכל בסדר - לפעמים ההודעות הולכות לאיבוד, אבל בונדינג חזק נשאר לנצח. ממש אשמח לשמור לך מקום לשיעור ניסיון אם יש בך רצון כזה, או לענות על כל שאלה.",
  "wa_sales_followup_2": "היי, {{bot_name}} כאן 👋 מ{{business_name}}. אני אומנם בוטית ואין לי ממש חיי חברה או עיסוקים, אבל רק מזכירה שאני עוד כאן ממתינה לתשובתך :) יש לך שאלה? אפשר לכתוב לי.",
  "wa_sales_followup_3": "הולה! זו {{bot_name}} מ{{business_name}} 🌟 זו הפעם האחרונה שאני אצור איתך קשר - כי אז יקראו לי חופרת 😊 אם יש בך רצון להתאהב בשגרת האימונים החדשה שלך, אני כאן כדי לגרום לזה לקרות. ואם יש עוד שאלות, תמיד אפשר לשאול אותי כאן או להרים טלפון ישירות למספר {{phone}} אנחנו כאן בשבילך! שיהיה המשך יום קסום.",
  "business_description": "שיעורים לכל הרמות\nיש לנו הלפרים שמסתובבים ועוזרים לכולם לתרגל בביטחון ובכיף\nהסטודיו גדול ומרווח\nקהילה בינלאומית חזקה, אנשים מדהימים וצבעוניים.\nאנחנו שומרים על בטיחות ברמה גבוהה כך שתוכלו לתרגל בלי לחשוש\nהאימון עובד על כל מרכיבי הכושר - כוח, גמישות, קוארדינציה, באלאנס ועוד...",
  "directions_media_url": "https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1776342059880-___________2026-04-16_______15_.18_.48_.png",
  "directions_media_type": "image",
  "customer_service_phone": "+972585902641",
  "segmentation_questions": [],
  "schedule_scan_image_url": "https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1780304181614-luz.jpeg",
  "followup_day_after_trial": "",
  "followup_after_registration": "",
  "arbox_membership_sync_source": "public_api",
  "whatsapp_idle_followup_message": "בוקר טוב 🙂 זואי מ־Acro by Joe.\n\nקשקשנו אתמול - רציתי לשאול אם יש לך עוד שאלות? אפשר ללחוץ על הכפתור ולהירשם לאימון ניסיון, או לכתוב לי כל שאלה.",
  "whatsapp_idle_followup_cta_kind": "trial",
  "whatsapp_idle_followup_cta_label": "הרשמה לשיעור ניסיון",
  "followup_after_hour_no_registration": "",
  "whatsapp_idle_followup_cta_custom_url": ""
}
$json$::jsonb,
  updated_at = now()
WHERE slug = 'acrobyjoe';

-- -----------------------------------------------------------------------------
-- 3) services — אקרו יוגה (id 12498)
-- -----------------------------------------------------------------------------
UPDATE public.services
SET
  name = 'אקרו יוגה',
  location_text = 'רוטשילד 122, תל אביב',
  description = '{"price_text":"80","duration":"80","payment_link":"https://acroyoga.web.arboxapp.com/membership/80601?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068","benefit_line":"שיעור האקרו שלנו הם דרך מעולה להתחזק, להתגמש, לכבוש אתגרים חדשים ולהכיר קהילה מדהימה. יש לנו שיעורים לרמת מתחילים עד מתקדמים!","description_text":"שיעור האקרו שלנו הם דרך מעולה להתחזק, להתגמש, לכבוש אתגרים חדשים ולהכיר קהילה מדהימה. יש לנו שיעורים לרמת מתחילים עד מתקדמים!","levels_enabled":true,"levels":["מתחילים","מתקדמים"],"offer_kind":"trial","course_sessions_count":"","trial_pick_media_url":"https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1780316860734-pic.jpg","trial_pick_media_type":"image","course_start_date":"","course_end_date":"","schedule_slots":[]}',
  updated_at = now()
WHERE id = 12498
  AND business_id = (SELECT id FROM public.businesses WHERE slug = 'acrobyjoe' LIMIT 1);

-- -----------------------------------------------------------------------------
-- 4) services — עמידות ידיים (id 12499)
-- -----------------------------------------------------------------------------
UPDATE public.services
SET
  name = 'עמידות ידיים',
  location_text = 'רוטשילד 122, תל אביב',
  description = '{"price_text":"70","duration":"60","payment_link":"https://acroyoga.web.arboxapp.com/membership/80601?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068","benefit_line":"שיעורי עמידות ידיים הם דרך מעולה להתחזק, לשפר יכולות פיזיות ולהתקדם בקצב נכון תוך חיזוק הגוף, הליבה ופתיחת טווחי תנועה שיביאו אתכם לעמידת ידיים המושלמת ומעבר.","description_text":"שיעורי עמידות ידיים הם דרך מעולה להתחזק, לשפר יכולות פיזיות ולהתקדם בקצב נכון תוך חיזוק הגוף, הליבה ופתיחת טווחי תנועה שיביאו אתכם לעמידת ידיים המושלמת ומעבר.","levels_enabled":false,"levels":[],"offer_kind":"trial","course_sessions_count":"","trial_pick_media_url":"","trial_pick_media_type":"","course_start_date":"","course_end_date":"","schedule_slots":[]}',
  updated_at = now()
WHERE id = 12499
  AND business_id = (SELECT id FROM public.businesses WHERE slug = 'acrobyjoe' LIMIT 1);

COMMIT;

-- =============================================================================
-- Verification queries (run after COMMIT)
-- =============================================================================

SELECT name, niche, bot_name, left(welcome_message, 40) AS welcome_preview
FROM public.businesses
WHERE slug = 'acrobyjoe';

SELECT name, price_text
FROM public.services
WHERE business_id = (SELECT id FROM public.businesses WHERE slug = 'acrobyjoe' LIMIT 1)
ORDER BY id;

SELECT
  social_links->>'welcome_intro' AS welcome_intro,
  social_links->'sales_flow'->>'experience_question' AS warmup_q,
  social_links->'welcome_options' AS welcome_options
FROM public.businesses
WHERE slug = 'acrobyjoe';
