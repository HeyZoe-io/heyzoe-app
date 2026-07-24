-- =============================================================================
-- acrobyjoe: translate all business content Hebrew → English (App Review screencast)
-- =============================================================================
-- Scope: slug = 'acrobyjoe' ONLY. No schema changes. No backup column. Full overwrite.
-- Run manually in Supabase Studio → SQL Editor. Do NOT auto-execute from CI.
--
-- Preserved as-is: URLs, ₪/prices, emojis, template vars ({priceText}, {{bot_name}}, etc.)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) businesses — scalar text fields
-- -----------------------------------------------------------------------------
UPDATE public.businesses
SET
  niche = 'Acro Yoga',
  bot_name = 'Zoe',
  welcome_message = E'Hi! Great to have you here 🙂\nMy name is Zoe from Acro by Joe,\nThe world''s largest acro yoga studio\nWe''d love to host you!\nWe''re located at Rothschild 122, Tel Aviv\nSo I can match you with exactly what you''re looking for,\nwhich class interests you most?\n1. Acro Yoga\n2. Handstands',
  updated_at = now()
WHERE slug = 'acrobyjoe';

-- -----------------------------------------------------------------------------
-- 2) businesses — social_links (full JSONB replace for readability)
-- -----------------------------------------------------------------------------
UPDATE public.businesses
SET
  social_links = $json$
{
  "vibe": ["Spiritual"],
  "fact1": "Classes for all levels",
  "fact2": "We have helpers who walk around and help everyone practice safely and with fun",
  "fact3": "The studio is large and spacious",
  "traits": [
    "Classes for all levels",
    "We have helpers who walk around and help everyone practice safely and with fun",
    "The studio is large and spacious",
    "A strong international community — amazing, colorful people.",
    "We maintain a high level of safety so you can practice without worry",
    "Training works on every fitness component — strength, flexibility, coordination, balance, and more..."
  ],
  "address": "Rothschild 122, Tel Aviv",
  "tagline": "The world's largest acro yoga studio",
  "instagram": "https://www.instagram.com/acrobyjoe/",
  "arbox_link": "https://acroyoga.web.arboxapp.com/group?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068&allLocations=false",
  "directions": "Free parking nearby",
  "objections": [],
  "promotions": "",
  "sales_flow": {
    "cta_body": "How about joining us for a trial class soon? The class costs {priceText} ₪, lasts {durationText} minutes, and it's going to be a lot of fun.",
    "cta_buttons": [
      {
        "id": "cta-trial",
        "kind": "trial",
        "label": "Sign up for trial class",
        "trial_cta_delivery": "link"
      },
      {
        "id": "cta-schedule",
        "kind": "schedule",
        "label": "View class schedule",
        "schedule_cta_delivery": "link",
        "schedule_cta_image_url": "",
        "schedule_cta_image_type": ""
      },
      {
        "id": "cta-memberships",
        "kind": "memberships",
        "label": "Membership pricing",
        "memberships_cta_delivery": "link",
        "memberships_price_range_max": "",
        "memberships_price_range_min": ""
      }
    ],
    "opening_note": "Opening and key details before the lead signs up for a trial class. Each follow-up answer is sent together with the next question and choice buttons (or a numbered list when there are more than three classes).",
    "cta_course_body": "How about joining our course? The price is {price} ₪, it runs for about {sessions} sessions, and it's going to be a lot of fun! Dates: {start_date} to {end_date}",
    "cta_extra_steps": [],
    "greeting_closer": "We'd love to host you!",
    "greeting_opener": "Hi! Great to have you here 🙂",
    "after_experience": "Wonderful — we're happy to welcome experienced practitioners to our studio. We have top-tier teachers.",
    "cta_workshop_body": "How about our workshop? The price is {price} ₪, it lasts {duration} minutes, and it's going to be a lot of fun!",
    "after_service_pick": "System rule: [opening word]! [prefix/name] [they/she] + trial class meta description (text as saved without editing).",
    "cta_course_buttons": [
      {
        "id": "cta-course-enroll",
        "kind": "course_enroll",
        "label": "Join the course",
        "secondary_purchase_delivery": "link"
      },
      {
        "id": "cta-course-contact",
        "kind": "course_contact",
        "label": "Contact us"
      }
    ],
    "experience_options": [
      "Strength and Toning",
      "Pain Reduction",
      "Stress Relief",
      "Fun and Variety"
    ],
    "experience_replies": [
      "Perfect. You've come to the right place. We have classes focused on strengthening and toning your body so you'll feel and look amazing.",
      "Excellent — we have classes focused on reducing pain while strengthening and lengthening the body.",
      "Wonderful. Our classes will let you take a break from it all, step out of the rush, and connect with body and mind.",
      "How fun! You've come to the right place. Our classes are full of fun and adrenaline — you'll always have a great reason to come."
    ],
    "greeting_line_name": "My name is {botName} from {businessName},",
    "experience_question": "What are you looking to achieve in our classes?",
    "opening_extra_steps": [],
    "cta_workshop_buttons": [
      {
        "id": "cta-workshop-buy",
        "kind": "workshop_purchase",
        "label": "Purchase workshop",
        "secondary_purchase_delivery": "link"
      },
      {
        "id": "cta-workshop-contact",
        "kind": "workshop_contact",
        "label": "Contact us"
      }
    ],
    "greeting_extra_steps": [],
    "greeting_line_tagline": "{tagline}",
    "free_chat_invite_reply": "No problem! Type freely and I'll reply 🙂",
    "multi_service_question": "So I can match you with exactly what you're looking for,\nwhich class interests you most?",
    "after_course_cycle_pick": "Excellent! We noted that you'd like to start {serviceName} on {requested_date}.",
    "after_experience_course": "So cool — the {serviceName} course will help you build a strong foundation and learn new skills.",
    "cta_body_after_schedule": "Now all that's left is to secure your spot with payment for the trial class. The class costs {priceText} ₪, lasts {durationText} minutes, and it's going to be a lot of fun. Shall we continue?",
    "show_memberships_button": true,
    "after_schedule_selection": "Awesome! We'll make sure to schedule you for {serviceName} on {requested_date} at {requested_time}!",
    "after_experience_workshop": "How fun to hear — the {serviceName} workshop is exactly the place for that.",
    "experience_options_course": [
      "Strength and Toning",
      "Pain Reduction",
      "Stress Relief",
      "Fun and Variety"
    ],
    "experience_replies_course": [
      "Perfect. You've come to the right place. We have classes focused on strengthening and toning your body so you'll feel and look amazing.",
      "Excellent — we have classes focused on reducing pain while strengthening and lengthening the body.",
      "Wonderful. Our classes will let you take a break from it all, step out of the rush, and connect with body and mind.",
      "How fun! You've come to the right place. Our classes are full of fun and adrenaline — you'll always have a great reason to come."
    ],
    "course_cycle_pick_question": "When would you like to start the course?",
    "experience_question_course": "What are you looking to achieve in our classes?",
    "opening_extra_steps_course": [],
    "experience_options_workshop": [
      "Strength and Toning",
      "Pain Reduction",
      "Stress Relief",
      "Fun and Variety"
    ],
    "experience_replies_workshop": [
      "Perfect. You've come to the right place. We have classes focused on strengthening and toning your body so you'll feel and look amazing.",
      "Excellent — we have classes focused on reducing pain while strengthening and lengthening the body.",
      "Wonderful. Our classes will let you take a break from it all, step out of the rush, and connect with body and mind.",
      "How fun! You've come to the right place. Our classes are full of fun and adrenaline — you'll always have a great reason to come."
    ],
    "experience_question_workshop": "What are you looking to achieve in our classes?",
    "opening_extra_steps_workshop": [],
    "after_trial_registration_body": "Well done! You're registered successfully 🎉\n\nWe're excited to see you soon!\nWe're at: {business_address}\n\nHow to get here:\n{business_directions}\n\nWe recommend arriving at least 10 minutes early, with a water bottle and your own towel!\nWe can't wait to see you. See you soon!\n\n{instagram_cta}",
    "after_course_registration_body": "Well done! You're registered successfully 🎉\n\nWe're excited to see you soon in the course!\nWe're at: {business_address}\n\nHow to get here:\n{business_directions}\n\nWe recommend arriving at least 10 minutes early, with a water bottle and your own towel!\nWe can't wait to see you. See you soon!\n\n{instagram_cta}",
    "followup_after_next_class_body": "Shall we book your class for you? 🙂",
    "after_workshop_registration_body": "Well done! You're registered successfully 🎉\n\nWe're excited to see you soon at the workshop!\nWe're at: {business_address}\n\nHow to get here:\n{business_directions}\n\nWe recommend arriving at least 10 minutes early, with a water bottle and your own towel!\nWe can't wait to see you. See you soon!\n\n{instagram_cta}",
    "after_schedule_selection_workshop": "Awesome! We'll schedule you for the {serviceName} workshop on {requested_date} at {requested_time}.",
    "followup_after_next_class_options": [
      "Sign up for trial class",
      "View class schedule",
      "Membership pricing"
    ],
    "after_trial_registration_body_after_schedule": "Well done! You're registered successfully 🎉\n\nWe're excited to see you soon for {serviceName} on {requested_date} at {requested_time}\nWe're at: {business_address}\n\nHow to get here:\n{business_directions}\n\nWe recommend arriving at least 10 minutes early, with a water bottle and your own towel!\nWe can't wait to see you. See you soon!\n\n{instagram_cta}",
    "after_course_registration_body_after_schedule": "Well done! You're registered successfully 🎉\n\nWe're excited to see you soon in {serviceName} — starting {requested_date}{course_schedule}\nWe're at: {business_address}\n\nHow to get here:\n{business_directions}\n\nWe recommend arriving at least 10 minutes early, with a water bottle and your own towel!\nWe can't wait to see you. See you soon!\n\n{instagram_cta}",
    "after_workshop_registration_body_after_schedule": "Well done! You're registered successfully 🎉\n\nWe're excited to see you soon at the {serviceName} workshop on {requested_date} at {requested_time}\nWe're at: {business_address}\n\nHow to get here:\n{business_directions}\n\nWe recommend arriving at least 10 minutes early, with a water bottle and your own towel!\nWe can't wait to see you. See you soon!\n\n{instagram_cta}"
  },
  "punch_cards": [],
  "website_url": "https://acrobyjoe.com/",
  "quick_replies": [],
  "welcome_intro": "Hi! Great to have you here 🙂\nMy name is Zoe from Acro by Joe,\nThe world's largest acro yoga studio\nWe'd love to host you!\nWe're located at Rothschild 122, Tel Aviv",
  "memberships_url": "https://acroyoga.web.arboxapp.com/membership?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068&allLocations=false",
  "welcome_options": [
    "Acro Yoga",
    "Handstands"
  ],
  "membership_tiers": [],
  "welcome_question": "So I can match you with exactly what you're looking for,\nwhich class interests you most?",
  "opening_media_url": "https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1776698799942-_______.mp4",
  "sales_flow_blocks": [],
  "opening_media_type": "video",
  "schedule_public_url": "",
  "wa_sales_followup_1": "Hi! 😊 Just wanted to make sure everything's okay — sometimes messages get lost, but a strong bond lasts forever. I'd love to save you a spot for a trial class if you're interested, or answer any question.",
  "wa_sales_followup_2": "Hi, {{bot_name}} here 👋 from {{business_name}}. I'm a bot and don't really have a social life or hobbies, but just a reminder that I'm still here waiting for your reply :) Have a question? You can write to me.",
  "wa_sales_followup_3": "Hey! It's {{bot_name}} from {{business_name}} 🌟 This is the last time I'll reach out — otherwise they'll call me a nag 😊 If you're ready to fall in love with your new training routine, I'm here to make it happen. And if you have more questions, you can always ask me here or call {{phone}} directly. We're here for you! Have a magical day.",
  "business_description": "Classes for all levels\nWe have helpers who walk around and help everyone practice safely and with fun\nThe studio is large and spacious\nA strong international community — amazing, colorful people.\nWe maintain a high level of safety so you can practice without worry\nTraining works on every fitness component — strength, flexibility, coordination, balance, and more...",
  "directions_media_url": "https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1776342059880-___________2026-04-16_______15_.18_.48_.png",
  "directions_media_type": "image",
  "customer_service_phone": "+972585902641",
  "segmentation_questions": [],
  "schedule_scan_image_url": "https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1780304181614-luz.jpeg",
  "followup_day_after_trial": "",
  "followup_after_registration": "",
  "arbox_membership_sync_source": "public_api",
  "whatsapp_idle_followup_message": "Good morning 🙂 Zoe from Acro by Joe.\n\nWe chatted yesterday — wanted to ask if you have any more questions? You can tap the button to sign up for a trial class, or write me any question.",
  "whatsapp_idle_followup_cta_kind": "trial",
  "whatsapp_idle_followup_cta_label": "Sign up for trial class",
  "followup_after_hour_no_registration": "",
  "whatsapp_idle_followup_cta_custom_url": ""
}
$json$::jsonb,
  updated_at = now()
WHERE slug = 'acrobyjoe';

-- -----------------------------------------------------------------------------
-- 3) services — Acro Yoga (id 12498)
-- -----------------------------------------------------------------------------
UPDATE public.services
SET
  name = 'Acro Yoga',
  location_text = 'Rothschild 122, Tel Aviv',
  description = '{"price_text":"80","duration":"80","payment_link":"https://acroyoga.web.arboxapp.com/membership/80601?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068","benefit_line":"Our acro classes are a great way to get stronger, more flexible, take on new challenges, and join an amazing community. We have classes from beginner to advanced levels!","description_text":"Our acro classes are a great way to get stronger, more flexible, take on new challenges, and join an amazing community. We have classes from beginner to advanced levels!","levels_enabled":true,"levels":["Beginners","Advanced"],"offer_kind":"trial","course_sessions_count":"","trial_pick_media_url":"https://ltbxmbqfenxkrwuoezou.supabase.co/storage/v1/object/public/business-assets/a654021c-c5f5-45be-8748-48cee3e47325/1780316860734-pic.jpg","trial_pick_media_type":"image","course_start_date":"","course_end_date":"","schedule_slots":[]}',
  updated_at = now()
WHERE id = 12498
  AND business_id = (SELECT id FROM public.businesses WHERE slug = 'acrobyjoe' LIMIT 1);

-- -----------------------------------------------------------------------------
-- 4) services — Handstands (id 12499)
-- -----------------------------------------------------------------------------
UPDATE public.services
SET
  name = 'Handstands',
  location_text = 'Rothschild 122, Tel Aviv',
  description = '{"price_text":"70","duration":"60","payment_link":"https://acroyoga.web.arboxapp.com/membership/80601?whitelabel=AcroByJoe&lang=en&referrer=SITE&location=3068","benefit_line":"Handstand classes are a great way to get stronger, improve physical skills, and progress at the right pace while building core strength and opening range of motion for the perfect handstand and beyond.","description_text":"Handstand classes are a great way to get stronger, improve physical skills, and progress at the right pace while building core strength and opening range of motion for the perfect handstand and beyond.","levels_enabled":false,"levels":[],"offer_kind":"trial","course_sessions_count":"","trial_pick_media_url":"","trial_pick_media_type":"","course_start_date":"","course_end_date":"","schedule_slots":[]}',
  updated_at = now()
WHERE id = 12499
  AND business_id = (SELECT id FROM public.businesses WHERE slug = 'acrobyjoe' LIMIT 1);

-- No FAQs for acrobyjoe (table empty).

COMMIT;

-- =============================================================================
-- Verification queries (run after COMMIT)
-- =============================================================================

SELECT name, niche, bot_name, welcome_message
FROM public.businesses
WHERE slug = 'acrobyjoe';

SELECT name, price_text, location_text
FROM public.services
WHERE business_id = (SELECT id FROM public.businesses WHERE slug = 'acrobyjoe' LIMIT 1)
ORDER BY id;

SELECT
  social_links->>'welcome_intro' AS welcome_intro,
  social_links->'sales_flow'->>'experience_question' AS warmup_q,
  social_links->'sales_flow'->>'cta_body' AS cta,
  social_links->'welcome_options' AS welcome_options
FROM public.businesses
WHERE slug = 'acrobyjoe';
