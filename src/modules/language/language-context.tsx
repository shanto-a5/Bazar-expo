import AsyncStorage from '@react-native-async-storage/async-storage';
import * as React from 'react';

export type LanguageCode = 'bn' | 'en';

const STORAGE_KEY = 'bazar.language.v1';

export const TRANSLATIONS = {
  bn: {
    // Navigation & Common
    home: 'হোম',
    cart: 'ঝুড়ি',
    save: 'পছন্দ',
    settings: 'সেটিংস',
    search: 'খুঁজুন',
    searchPlaceholder: 'পণ্য খুঁজুন...',
    close: 'বন্ধ করুন',
    cancel: 'বাতিল',
    open: 'খুলুন',
    tryAgain: 'আবার চেষ্টা করুন',
    couldntRefresh: 'রিফ্রেশ করা যায়নি',
    showingSavedCatalogue: 'সর্বশেষ সংরক্ষিত তালিকা দেখানো হচ্ছে।',
    notifications: 'নোটিফিকেশন',
    myCart: 'আমার ঝুড়ি',
    yourArea: 'আপনার এলাকা',
    tapToChange: 'পরিবর্তন করতে ট্যাপ করুন',
    newBadge: 'নতুন',
    soldSuffix: 'বিক্রি',
    offSuffix: '% ছাড়',
    loadingProducts: 'পণ্য লোড হচ্ছে',

    // Search Overlay
    suggestedSearches: 'জনপ্রিয় অনুসন্ধান',
    recentSearches: 'সাম্প্রতিক অনুসন্ধান',
    clearHistory: 'মুছুন',
    matchingProducts: 'মিলে যাওয়া পণ্য',
    noSearchMatches: 'কোনো পণ্য পাওয়া যায়নি',

    // Empty Home State
    emptyAreaPrimary: 'এখানে এখনো কোনো দোকান নেই। আমরা স্থানীয় বিক্রেতাদের জানিয়েছি!',
    emptyAreaSecondary: 'No shops are available here yet. We have notified local sellers!',
    chooseAnotherArea: 'অন্য এলাকা বাছাই করুন · Choose another area',

    // Quick View & Product
    addToCart: 'ঝুড়িতে যোগ করুন',
    addedToCart: 'যোগ হয়েছে ✓',
    buyNow: 'এখনই কিনুন',
    perUnitPrice: 'প্রতি কেজি / একক মূল্য',
    unitWeightLabel: 'একক / ওজন',
    defaultUnitWeight: '১ কেজি / স্ট্যান্ডার্ড প্যাক',
    inStock: 'স্টকে আছে',
    outOfStock: 'স্টকে নেই',

    // Mini-Cart & 1-Click Checkout
    yourCart: 'আপনার ঝুড়ি',
    cartEmptyTitle: 'আপনার ঝুড়ি খালি',
    cartEmptyCaption: 'যেকোনো পণ্যে ট্যাপ করে ঝুড়িতে যোগ করুন।',
    subtotalExclDelivery: 'মোট (ডেলিভারি ছাড়া)',
    total: 'মোট',
    remove: 'সরান',
    orderPlaced: 'আপনার অর্ডার সম্পন্ন হয়েছে!',
    orderPlacedSub: 'ক্যাশ অন ডেলিভারি · হোম পেজে ফিরে যাওয়া হচ্ছে...',
    guestPhoneTitle: 'আপনার মোবাইল নম্বর দিন',
    guestPhoneSubtitle: '১-ক্লিকে অর্ডার করতে শুধু আপনার ফোন নম্বর দিন। GPS অবস্থান স্বয়ংক্রিয়ভাবে নেওয়া হচ্ছে।',
    phoneNumberLabel: 'মোবাইল নম্বর',
    phonePlaceholder: '01XXXXXXXXX',
    phoneInvalidError: 'সঠিক মোবাইল নম্বর দিন (কমপক্ষে ৬ সংখ্যার)',
    gpsFetching: 'GPS অবস্থান নেওয়া হচ্ছে...',
    gpsReady: 'GPS অবস্থান সংযুক্ত হয়েছে',
    gpsFallback: 'নির্বাচিত এলাকায় ডেলিভারি হবে',
    confirmOrder: 'অর্ডার কনফার্ম করুন',
    placingOrder: 'অর্ডার হচ্ছে...',
    orderStepVerifyPhone: 'আপনার নম্বর যাচাই করা হচ্ছে...',
    orderStepConfirmLocation: 'লোকেশন নিশ্চিত করা হচ্ছে...',
    orderStepCalculateTotal: 'মোট হিসাব করা হচ্ছে...',
    orderStepPrepareOrder: 'অর্ডার প্রস্তুত করা হচ্ছে...',

    // Settings
    settingsSubtitle: 'আপনার অ্যাকাউন্ট ও ভাষা',
    languageTitle: 'ভাষা · Language',
    languageCaption: 'অ্যাপের ভাষা নির্বাচন করুন',
    banglaName: 'বাংলা',
    englishName: 'English',
    shoppingArea: 'কেনাকাটার এলাকা',
    chooseWhereYouShop: 'আপনার এলাকা বাছাই করুন',
    setPassword: 'পাসওয়ার্ড সেট করুন',
    setPasswordCaption: 'যেকোনো ডিভাইস থেকে সাইন ইন করুন',
    account: 'অ্যাকাউন্ট',
    accountCaption: 'নাম, ইমেইল, ফোন এবং পাসওয়ার্ড',
    addressBook: 'ঠিকানা তালিকা',
    addressBookCaption: 'ডেলিভারি ঠিকানা এবং ডিফল্ট নির্বাচন',
    wishlist: 'পছন্দের তালিকা',
    wishlistCaption: 'পরে কেনার জন্য সংরক্ষিত পণ্য',
    vouchers: 'ভাউচার',
    vouchersCaption: 'আপনার ঝুড়িতে প্রযোজ্য ডিসকাউন্ট কোড',
    myReviews: 'আমার রিভিউ',
    myReviewsCaption: 'ডেলিভারি হওয়া পণ্যের রেটিং ও রিভিউ',
    myOrders: 'আমার অর্ডার',
    myOrdersCaption: 'অর্ডার ট্র্যাক, বাতিল বা রিটার্ন করুন',
    notificationsCaption: 'অর্ডার এবং রিটার্ন আপডেট',
    unreadUpdatesSuffix: 'টি অপঠিত আপডেট',
    signOut: 'সাইন আউট',
    signOutEverywhere: 'সব ডিভাইস থেকে সাইন আউট',
    signOutFailed: 'সাইন আউট ব্যর্থ হয়েছে',
    customerAccount: 'গ্রাহক অ্যাকাউন্ট',
    customerAccountCaption: 'অর্ডার করতে, পণ্য সংরক্ষণ করতে এবং ডেলিভারি ট্র্যাক করতে অ্যাকাউন্ট প্রয়োজন',
    guestBrowseNotice: 'আপনি গেস্ট হিসেবে ব্রাউজ করছেন। অ্যাকাউন্ট ছাড়াই ব্রাউজ, সার্চ এবং ১-ক্লিক অর্ডার করতে পারবেন।',
    signIn: 'সাইন ইন',
    createAccount: 'অ্যাকাউন্ট তৈরি করুন',
  },
  en: {
    // Navigation & Common
    home: 'Home',
    cart: 'Cart',
    save: 'Save',
    settings: 'Settings',
    search: 'Search',
    searchPlaceholder: 'Search products...',
    close: 'Close',
    cancel: 'Cancel',
    open: 'Open',
    tryAgain: 'Try again',
    couldntRefresh: "Couldn't refresh",
    showingSavedCatalogue: 'Showing the last saved catalogue.',
    notifications: 'Notifications',
    myCart: 'My cart',
    yourArea: 'Your area',
    tapToChange: 'Tap to change',
    newBadge: 'New',
    soldSuffix: 'sold',
    offSuffix: '% OFF',
    loadingProducts: 'Loading products',

    // Search Overlay
    suggestedSearches: 'Suggested searches',
    recentSearches: 'Recent searches',
    clearHistory: 'Clear',
    matchingProducts: 'Matching products',
    noSearchMatches: 'No matching products found',

    // Empty Home State
    emptyAreaPrimary: 'No shops are available here yet. We have notified local sellers!',
    emptyAreaSecondary: 'এখানে এখনো কোনো দোকান নেই। আমরা স্থানীয় বিক্রেতাদের জানিয়েছি!',
    chooseAnotherArea: 'Choose another area · অন্য এলাকা বাছাই করুন',

    // Quick View & Product
    addToCart: 'Add to Cart',
    addedToCart: 'Added ✓',
    buyNow: 'Buy Now',
    perUnitPrice: 'Per kg / unit price',
    unitWeightLabel: 'Unit / Weight',
    defaultUnitWeight: '1 kg / Standard pack',
    inStock: 'In stock',
    outOfStock: 'Out of stock',

    // Mini-Cart & 1-Click Checkout
    yourCart: 'Your Cart',
    cartEmptyTitle: 'Your cart is empty',
    cartEmptyCaption: 'Tap any product to add it to your cart.',
    subtotalExclDelivery: 'Subtotal (excl. delivery)',
    total: 'Total',
    remove: 'Remove',
    orderPlaced: 'Your order is placed!',
    orderPlacedSub: 'Cash on Delivery · Returning to home...',
    guestPhoneTitle: 'Enter your phone number',
    guestPhoneSubtitle: 'Enter only your phone number for 1-click checkout. Fetching GPS coordinates automatically.',
    phoneNumberLabel: 'Phone Number',
    phonePlaceholder: '01XXXXXXXXX',
    phoneInvalidError: 'Enter a valid phone number (at least 6 digits)',
    gpsFetching: 'Getting GPS coordinates...',
    gpsReady: 'GPS coordinates captured',
    gpsFallback: 'Using active area for delivery',
    confirmOrder: 'Confirm Order',
    placingOrder: 'Placing order...',
    orderStepVerifyPhone: 'Verifying your number...',
    orderStepConfirmLocation: 'Confirming location...',
    orderStepCalculateTotal: 'Calculating total...',
    orderStepPrepareOrder: 'Preparing your order...',

    // Settings
    settingsSubtitle: 'Your account & language',
    languageTitle: 'Language · ভাষা',
    languageCaption: 'Choose your preferred app language',
    banglaName: 'বাংলা',
    englishName: 'English',
    shoppingArea: 'Shopping area',
    chooseWhereYouShop: 'Choose where you shop',
    setPassword: 'Set a password',
    setPasswordCaption: 'Sign in from any device, not just this one',
    account: 'Account',
    accountCaption: 'Name, email, phone and password',
    addressBook: 'Address book',
    addressBookCaption: 'Delivery addresses, default selection and checkout use',
    wishlist: 'Wishlist',
    wishlistCaption: 'Items you saved for later',
    vouchers: 'Vouchers',
    vouchersCaption: 'Codes that work on your current cart',
    myReviews: 'My reviews',
    myReviewsCaption: 'Ratings and reviews you wrote for delivered items',
    myOrders: 'My orders',
    myOrdersCaption: 'Track, cancel or return anything you ordered',
    notificationsCaption: 'Order and return updates',
    unreadUpdatesSuffix: 'unread update(s)',
    signOut: 'Sign out',
    signOutEverywhere: 'Sign out of all devices',
    signOutFailed: 'Sign out failed',
    customerAccount: 'Customer account',
    customerAccountCaption: 'An account is needed to place an order, save items and track deliveries',
    guestBrowseNotice: 'You are browsing as a guest. Browsing, searching and your cart all work without an account.',
    signIn: 'Sign in',
    createAccount: 'Create an account',
  },
} as const;

export type TranslationKey = keyof typeof TRANSLATIONS.bn;
export type TranslationDictionary = Record<TranslationKey, string>;

interface LanguageContextValue {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: TranslationKey) => string;
  strings: TranslationDictionary;
}

const LanguageContext = React.createContext<LanguageContextValue>({
  language: 'bn',
  setLanguage: () => undefined,
  t: (key) => TRANSLATIONS.bn[key],
  strings: TRANSLATIONS.bn,
});

export function LanguageProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = React.useState<LanguageCode>('bn');

  React.useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (cancelled) return;
        if (saved === 'bn' || saved === 'en') {
          setLanguageState(saved);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = React.useCallback((next: LanguageCode) => {
    setLanguageState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = React.useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key: TranslationKey) => TRANSLATIONS[language][key] ?? TRANSLATIONS.bn[key],
      strings: TRANSLATIONS[language],
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return React.useContext(LanguageContext);
}
