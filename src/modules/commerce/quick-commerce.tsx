import { Image as ExpoImage } from 'expo-image';
import { router, usePathname } from 'expo-router';
import * as React from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { taka } from '@/components/ui';
import type { Address, Product } from '@/domain/types';
import { useArea } from '@/modules/area/area-context';
import { useLanguage } from '@/modules/language/language-context';
import { useQuickAccount } from '@/modules/session/quick-account-modal';
import { useSession } from '@/modules/session/session-context';
import { addressService } from '@/services/address-service';
import { authService } from '@/services/auth-gateway';
import { cartService } from '@/services/cart-service';
import { catalogService, effectivePrice } from '@/services/catalog-service';
import { orderService } from '@/services/order-service';
import { colors, makeShadow, radius, spacing, type } from '@/theme/tokens';
import { makePaletteImage, resolveImage } from '@/utils/image';

const SUCCESS_DURATION_MS = 1000;

function resolveProductUnitLabel(product: Product, defaultLabel: string): string {
  if (product.variants && product.variants.length > 0) {
    const first = product.variants[0];
    const attrs = Object.values(first.attributes ?? {}).filter(Boolean);
    if (attrs.length > 0) return attrs.join(' · ');
    if (first.sku) return first.sku;
  }
  const match = product.name.match(/(\d+(?:\.\d+)?\s*(?:kg|g|gm|ml|l|ltr|pc|pcs|কেজি|গ্রাম|লিটার|পিস))/i);
  if (match) return match[1];
  return defaultLabel;
}

function buildOneClickAddress(params: {
  userId: string;
  userName?: string;
  userPhone?: string;
  areaName?: string;
}): Address {
  const cached = addressService.getDefault(params.userId);
  const activeArea = (params.areaName ?? '').trim() || 'Bangladesh';
  const rawRecipient = (cached?.recipientName || params.userName || params.userPhone || 'Customer').trim();
  const recipientName = rawRecipient.length >= 2 ? rawRecipient : 'Customer';
  const rawPhone = (cached?.phone || params.userPhone || '01700000000').trim();
  const phone = rawPhone.length >= 6 ? rawPhone : '01700000000';
  const rawDivision = (cached?.division || activeArea || 'Bangladesh').trim();
  const division = rawDivision.length >= 2 ? rawDivision : 'Bangladesh';
  const rawDistrict = (cached?.district || activeArea || 'Bangladesh').trim();
  const district = rawDistrict.length >= 2 ? rawDistrict : 'Bangladesh';
  const area = (cached?.area || activeArea).trim();

  const latitude = cached?.latitude;
  const longitude = cached?.longitude;
  const hasCoords =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  let addressLine = (cached?.addressLine || '').trim();
  if (addressLine.length < 4) {
    addressLine = hasCoords
      ? `GPS ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (${activeArea})`
      : `${activeArea} Village Delivery`;
  }

  const now = new Date().toISOString();
  return {
    id: cached?.id || 'addr_1click',
    userId: params.userId,
    label: cached?.label || '1-Click Delivery',
    recipientName,
    phone,
    division,
    district,
    area,
    addressLine,
    postalCode: cached?.postalCode || '',
    isDefault: true,
    createdAt: cached?.createdAt || now,
    updatedAt: cached?.updatedAt || now,
    ...(hasCoords ? { latitude, longitude } : {}),
  };
}

function QuickProductVisual({ uri, name }: { uri?: string | null; name: string }): React.JSX.Element {
  const resolved = resolveImage(uri && uri.length > 0 ? uri : makePaletteImage(name, 'store'));
  if (!resolved) {
    return <View style={[styles.fill, { backgroundColor: colors.surfaceMuted }]} />;
  }
  if (resolved.kind === 'uri') {
    return (
      <ExpoImage
        source={resolved.uri}
        contentFit="cover"
        transition={120}
        style={[styles.fill, { backgroundColor: colors.surfaceMuted }]}
      />
    );
  }
  return (
    <View style={[styles.fill, { alignItems: 'center', justifyContent: 'center', backgroundColor: resolved.c1 }]}>
      <Text style={{ fontSize: 32 }}>{resolved.emoji}</Text>
    </View>
  );
}

interface QuickCommerceContextValue {
  quickViewProduct: Product | null;
  miniCartOpen: boolean;
  cartBounceScale: Animated.Value;
  openQuickView: (product: Product) => void;
  closeQuickView: () => void;
  openMiniCart: () => void;
  closeMiniCart: () => void;
  triggerBuyNowProduct: (product: Product) => void;
  triggerBuyNowCart: () => void;
}

const QuickCommerceContext = React.createContext<QuickCommerceContextValue | null>(null);

export function useQuickCommerce(): QuickCommerceContextValue {
  const ctx = React.useContext(QuickCommerceContext);
  if (!ctx) throw new Error('useQuickCommerce must be used inside QuickCommerceProvider');
  return ctx;
}

type PendingBuyTarget =
  | { kind: 'product'; product: Product }
  | { kind: 'cart'; itemsSnapshot: { productId: string; quantity: number; variantId?: string }[] };

export function QuickCommerceProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, status, cartOwnerId } = useSession();
  const { present: presentQuickAccount, dismiss: dismissQuickAccount } = useQuickAccount();
  const { area } = useArea();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const [quickViewProduct, setQuickViewProduct] = React.useState<Product | null>(null);
  const [miniCartOpen, setMiniCartOpen] = React.useState(false);
  const [quickAccountOpen, setQuickAccountOpen] = React.useState(false);
  const [placingOrder, setPlacingOrder] = React.useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = React.useState(0);
  const [orderError, setOrderError] = React.useState<string | null>(null);
  const [orderSuccessVisible, setOrderSuccessVisible] = React.useState(false);
  const [justAddedId, setJustAddedId] = React.useState<string | null>(null);

  const userRef = React.useRef(user);
  React.useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Animations
  const [quickViewAnim] = React.useState(() => new Animated.Value(0));
  const [miniCartAnim] = React.useState(() => new Animated.Value(0));
  const [cartBounceScale] = React.useState(() => new Animated.Value(1));
  const [successTimerProgress] = React.useState(() => new Animated.Value(1));
  const [spinAnim] = React.useState(() => new Animated.Value(0));

  const orderLoadingSteps = React.useMemo(
    () => [
      t('orderStepVerifyPhone'),
      t('orderStepConfirmLocation'),
      t('orderStepCalculateTotal'),
      t('orderStepPrepareOrder'),
    ],
    [t],
  );

  // Cycle through progressive loading steps every 600ms while placingOrder is active
  React.useEffect(() => {
    if (!placingOrder) {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
      return;
    }

    spinAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();

    const interval = setInterval(() => {
      setLoadingStepIndex((prev) => (prev < 3 ? prev + 1 : prev));
    }, 600);

    return () => {
      loop.stop();
      clearInterval(interval);
    };
  }, [placingOrder, spinAnim]);

  // Subscribe to add-to-cart events to bounce the Cart header icon
  React.useEffect(() => {
    return cartService.subscribeAddItem(() => {
      cartBounceScale.setValue(1);
      Animated.sequence([
        Animated.timing(cartBounceScale, {
          toValue: 1.32,
          duration: 130,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(cartBounceScale, {
          toValue: 1,
          friction: 4,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [cartBounceScale]);

  const openQuickView = React.useCallback(
    (product: Product) => {
      setOrderError(null);
      setMiniCartOpen(false);
      setQuickViewProduct(product);
      quickViewAnim.setValue(0);
      Animated.spring(quickViewAnim, {
        toValue: 1,
        damping: 18,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
    [quickViewAnim],
  );

  const closeQuickView = React.useCallback(() => {
    Animated.timing(quickViewAnim, {
      toValue: 0,
      duration: 120,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setQuickViewProduct(null);
      setOrderError(null);
    });
  }, [quickViewAnim]);

  const openMiniCart = React.useCallback(() => {
    setOrderError(null);
    setQuickViewProduct(null);
    setMiniCartOpen(true);
    miniCartAnim.setValue(0);
    Animated.timing(miniCartAnim, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [miniCartAnim]);

  const closeMiniCart = React.useCallback(() => {
    Animated.timing(miniCartAnim, {
      toValue: 0,
      duration: 120,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setMiniCartOpen(false);
      setOrderError(null);
    });
  }, [miniCartAnim]);

  // Hardware Back-Button Hijacking (STEP 3.2)
  React.useEffect(() => {
    const anyModalOpen =
      Boolean(quickViewProduct) || miniCartOpen || quickAccountOpen || placingOrder || orderSuccessVisible;
    if (!anyModalOpen) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (placingOrder || orderSuccessVisible) {
        return true;
      }
      if (quickAccountOpen) {
        dismissQuickAccount();
        return true;
      }
      if (quickViewProduct) {
        closeQuickView();
        return true;
      }
      if (miniCartOpen) {
        closeMiniCart();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [quickViewProduct, miniCartOpen, quickAccountOpen, placingOrder, orderSuccessVisible, dismissQuickAccount, closeQuickView, closeMiniCart]);

  // Show 1000ms order placed state, then auto-close & reset to Home
  const triggerOrderSuccess = React.useCallback(() => {
    setPlacingOrder(false);
    setQuickAccountOpen(false);
    setQuickViewProduct(null);
    setMiniCartOpen(false);
    setOrderError(null);
    setOrderSuccessVisible(true);
    successTimerProgress.setValue(1);

    Animated.timing(successTimerProgress, {
      toValue: 0,
      duration: SUCCESS_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    setTimeout(() => {
      setOrderSuccessVisible(false);
      if (pathname !== '/') {
        router.replace('/(home)');
      }
    }, SUCCESS_DURATION_MS);
  }, [pathname, successTimerProgress]);

  const executeOneClickOrder = React.useCallback(
    async (params: {
      activeUserId: string;
      activeUserName?: string;
      activeUserPhone?: string;
      target: PendingBuyTarget;
    }) => {
      setLoadingStepIndex(0);
      setPlacingOrder(true);
      setOrderError(null);
      try {
        if (params.target.kind === 'product') {
          const product = params.target.product;
          const variantId = product.hasVariants && product.variants.length > 0 ? product.variants[0].id : undefined;
          await cartService.addItemAsync(params.activeUserId, product.id, 1, variantId);
        } else {
          // Ensure any guest items captured before authentication are in the server cart
          const currentItems = cartService.items(params.activeUserId);
          if (currentItems.length === 0 && params.target.itemsSnapshot.length > 0) {
            for (const line of params.target.itemsSnapshot) {
              await cartService.addItemAsync(params.activeUserId, line.productId, line.quantity, line.variantId);
            }
          }
        }

        const deliveryAddress = buildOneClickAddress({
          userId: params.activeUserId,
          userName: params.activeUserName,
          userPhone: params.activeUserPhone,
          areaName: area?.name,
        });

        await orderService.createOrder(params.activeUserId, {
          address: deliveryAddress,
          paymentMethod: 'cod',
        });

        triggerOrderSuccess();
      } catch (err) {
        setPlacingOrder(false);
        setOrderError(err instanceof Error ? err.message : 'Could not place order.');
      }
    },
    [area, triggerOrderSuccess],
  );

  const promptGuestQuickAccount = React.useCallback(
    (target: PendingBuyTarget) => {
      setOrderError(null);
      setQuickAccountOpen(true);
      presentQuickAccount({
        onAuthenticated: () => {
          setQuickAccountOpen(false);
          void (async () => {
            const activeUser = userRef.current ?? (await authService.getCurrentUser().catch(() => null));
            if (!activeUser) return;
            await executeOneClickOrder({
              activeUserId: activeUser.id,
              activeUserName: activeUser.name,
              activeUserPhone: activeUser.phone,
              target,
            });
          })();
        },
        onDismiss: () => {
          setQuickAccountOpen(false);
        },
      });
    },
    [presentQuickAccount, executeOneClickOrder],
  );

  const triggerBuyNowProduct = React.useCallback(
    (product: Product) => {
      const target: PendingBuyTarget = { kind: 'product', product };
      if (status === 'signedIn' && user) {
        void executeOneClickOrder({
          activeUserId: user.id,
          activeUserName: user.name,
          activeUserPhone: user.phone,
          target,
        });
      } else {
        promptGuestQuickAccount(target);
      }
    },
    [status, user, executeOneClickOrder, promptGuestQuickAccount],
  );

  const triggerBuyNowCart = React.useCallback(() => {
    const items = cartService.items(cartOwnerId).filter((i) => i.selected);
    if (items.length === 0) return;
    const snapshot = items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      variantId: i.variantId,
    }));
    const target: PendingBuyTarget = { kind: 'cart', itemsSnapshot: snapshot };

    if (status === 'signedIn' && user) {
      void executeOneClickOrder({
        activeUserId: user.id,
        activeUserName: user.name,
        activeUserPhone: user.phone,
        target,
      });
    } else {
      promptGuestQuickAccount(target);
    }
  }, [cartOwnerId, status, user, executeOneClickOrder, promptGuestQuickAccount]);

  const handleAddToCartFromQuickView = React.useCallback(
    (product: Product) => {
      try {
        const variantId = product.hasVariants && product.variants.length > 0 ? product.variants[0].id : undefined;
        cartService.addItem(cartOwnerId, product.id, 1, variantId);
        setJustAddedId(product.id);
        setTimeout(() => {
          setJustAddedId((curr) => (curr === product.id ? null : curr));
        }, 900);
      } catch (err) {
        setOrderError(err instanceof Error ? err.message : 'Could not add item.');
      }
    },
    [cartOwnerId],
  );

  // Cart items & subtotal for Mini-Cart
  const rawCartItems = cartService.items(cartOwnerId);
  const miniCartLines = React.useMemo(() => {
    return rawCartItems.map((item) => {
      const product = catalogService.getProduct(item.productId);
      const unitPrice = item.priceSnapshot || (product ? effectivePrice(product) : 0);
      return {
        item,
        product,
        name: product?.name ?? 'Product',
        image: product?.images?.[0] ?? null,
        unitPrice,
        lineTotal: unitPrice * item.quantity,
      };
    });
  }, [rawCartItems]);

  const miniCartSubtotal = React.useMemo(
    () => miniCartLines.reduce((sum, line) => sum + (line.item.selected ? line.lineTotal : 0), 0),
    [miniCartLines],
  );

  const contextValue = React.useMemo<QuickCommerceContextValue>(
    () => ({
      quickViewProduct,
      miniCartOpen,
      cartBounceScale,
      openQuickView,
      closeQuickView,
      openMiniCart,
      closeMiniCart,
      triggerBuyNowProduct,
      triggerBuyNowCart,
    }),
    [
      quickViewProduct,
      miniCartOpen,
      cartBounceScale,
      openQuickView,
      closeQuickView,
      openMiniCart,
      closeMiniCart,
      triggerBuyNowProduct,
      triggerBuyNowCart,
    ],
  );

  const quickViewScale = quickViewAnim.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const quickViewTranslateX = quickViewAnim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });
  const quickViewTranslateY = quickViewAnim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });

  const timerWidth = successTimerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const spinRotate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <QuickCommerceContext.Provider value={contextValue}>
      <View style={styles.fill}>
        {children}

        {/* STEP 3: Snappy Top-Left Quick View Modal (~80% of screen) */}
        {quickViewProduct ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable
              onPress={closeQuickView}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={[StyleSheet.absoluteFill, styles.backdrop]}
            />
            <Animated.View
              style={[
                styles.quickViewCard,
                {
                  top: insets.top + spacing.sm,
                  left: spacing.sm,
                  opacity: quickViewAnim,
                  transform: [
                    { translateX: quickViewTranslateX },
                    { translateY: quickViewTranslateY },
                    { scale: quickViewScale },
                  ],
                },
              ]}
            >
              <View style={styles.quickViewImageWrap}>
                <QuickProductVisual uri={quickViewProduct.images?.[0]} name={quickViewProduct.name} />
                <Pressable
                  onPress={closeQuickView}
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                  style={({ pressed }) => [styles.closePill, pressed && styles.pressed]}
                >
                  <Text style={styles.closePillText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.quickViewBody}
                contentContainerStyle={styles.quickViewBodyContent}
                showsVerticalScrollIndicator={false}
              >
                {/* Priority 1: Exceptionally large Price font */}
                <View style={styles.quickPriceRow}>
                  <Text style={styles.quickHugePrice}>{taka(effectivePrice(quickViewProduct))}</Text>
                  {quickViewProduct.salePrice && quickViewProduct.salePrice < quickViewProduct.regularPrice ? (
                    <Text style={styles.quickRegularPrice}>{taka(quickViewProduct.regularPrice)}</Text>
                  ) : null}
                </View>

                {/* Priority 2: Product Name */}
                <Text style={styles.quickProductName}>{quickViewProduct.name}</Text>

                {/* Priority 3: Unit / Weight (e.g., per-kg price) */}
                <View style={styles.unitBadgeRow}>
                  <View style={styles.unitBadge}>
                    <Text style={styles.unitBadgeText}>
                      ⚖️ {t('unitWeightLabel')}: {resolveProductUnitLabel(quickViewProduct, t('defaultUnitWeight'))}
                    </Text>
                  </View>
                  <Text style={styles.perUnitCaption}>
                    {taka(effectivePrice(quickViewProduct))} ({t('perUnitPrice')})
                  </Text>
                </View>

                {orderError ? <Text style={styles.errorText}>{orderError}</Text> : null}
              </ScrollView>

              {/* Bottom-Right Action Buttons */}
              <View style={styles.quickActionsFooter}>
                <Pressable
                  onPress={() => handleAddToCartFromQuickView(quickViewProduct)}
                  disabled={placingOrder}
                  accessibilityRole="button"
                  accessibilityLabel={t('addToCart')}
                  style={({ pressed }) => [styles.addToCartGreenBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.addToCartGreenBtnText}>
                    {justAddedId === quickViewProduct.id ? t('addedToCart') : `🛒 ${t('addToCart')}`}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => triggerBuyNowProduct(quickViewProduct)}
                  disabled={placingOrder}
                  accessibilityRole="button"
                  accessibilityLabel={t('buyNow')}
                  style={({ pressed }) => [styles.buyNowBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.buyNowBtnText}>⚡ {t('buyNow')}</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        ) : null}

        {/* STEP 4.1: Mini-Cart Overlay */}
        {miniCartOpen ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <Pressable
              onPress={closeMiniCart}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={[StyleSheet.absoluteFill, styles.backdrop]}
            />
            <Animated.View
              style={[
                styles.miniCartSheet,
                {
                  top: insets.top + spacing.xl,
                  opacity: miniCartAnim,
                },
              ]}
            >
              <View style={styles.miniCartHeader}>
                <Text style={styles.miniCartTitle}>🛍️ {t('yourCart')}</Text>
                <Pressable
                  onPress={closeMiniCart}
                  accessibilityRole="button"
                  accessibilityLabel={t('close')}
                  style={({ pressed }) => [styles.closeCircle, pressed && styles.pressed]}
                >
                  <Text style={styles.closeCircleText}>✕</Text>
                </Pressable>
              </View>

              {miniCartLines.length === 0 ? (
                <View style={styles.miniCartEmpty}>
                  <Text style={styles.miniCartEmptyTitle}>{t('cartEmptyTitle')}</Text>
                  <Text style={styles.miniCartEmptyCaption}>{t('cartEmptyCaption')}</Text>
                </View>
              ) : (
                <>
                  <ScrollView style={styles.miniCartList} contentContainerStyle={{ gap: spacing.sm }}>
                    {miniCartLines.map((line) => (
                      <View key={line.item.id} style={styles.miniCartRow}>
                        <View style={styles.miniCartThumb}>
                          <QuickProductVisual uri={line.image} name={line.name} />
                        </View>
                        <View style={styles.miniCartInfo}>
                          <Text numberOfLines={1} style={styles.miniCartItemName}>
                            {line.name}
                          </Text>
                          <Text style={styles.miniCartItemMeta}>
                            {taka(line.unitPrice)} × {line.item.quantity} = {taka(line.lineTotal)}
                          </Text>
                        </View>
                        <View style={styles.miniCartStepper}>
                          <Pressable
                            onPress={() => {
                              if (line.item.quantity <= 1) {
                                cartService.removeItem(cartOwnerId, line.item.id);
                              } else {
                                cartService.updateQuantity(cartOwnerId, line.item.id, line.item.quantity - 1);
                              }
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={t('remove')}
                            style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}
                          >
                            <Text style={styles.stepperBtnText}>−</Text>
                          </Pressable>
                          <Text style={styles.stepperQty}>{line.item.quantity}</Text>
                          <Pressable
                            onPress={() =>
                              cartService.updateQuantity(cartOwnerId, line.item.id, line.item.quantity + 1)
                            }
                            accessibilityRole="button"
                            accessibilityLabel={t('addToCart')}
                            style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}
                          >
                            <Text style={styles.stepperBtnText}>+</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </ScrollView>

                  {orderError ? <Text style={styles.errorText}>{orderError}</Text> : null}

                  <View style={styles.miniCartFooter}>
                    <View style={styles.subtotalRow}>
                      <Text style={styles.subtotalLabel}>{t('subtotalExclDelivery')}</Text>
                      <Text style={styles.subtotalValue}>{taka(miniCartSubtotal)}</Text>
                    </View>
                    <Pressable
                      onPress={triggerBuyNowCart}
                      disabled={placingOrder}
                      accessibilityRole="button"
                      accessibilityLabel={t('buyNow')}
                      style={({ pressed }) => [styles.miniCartBuyBtn, pressed && styles.pressed]}
                    >
                      <Text style={styles.miniCartBuyBtnText}>
                        ⚡ {t('buyNow')} · {taka(miniCartSubtotal)}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </Animated.View>
          </View>
        ) : null}

        {/* STEP 3: "Agent-like" Progressive Loading Overlay */}
        {placingOrder ? (
          <View style={[StyleSheet.absoluteFill, styles.centerOverlay, styles.backdropDark]}>
            <View style={styles.agentLoadingCard}>
              {orderLoadingSteps.slice(0, loadingStepIndex + 1).map((stepText, idx) => {
                const isCurrent = idx === loadingStepIndex;
                return (
                  <View key={stepText} style={styles.agentStepRow}>
                    {isCurrent ? (
                      <Animated.View
                        style={[
                          styles.agentSpinnerRing,
                          { transform: [{ rotate: spinRotate }] },
                        ]}
                      />
                    ) : (
                      <View style={styles.agentStepCheckBadge}>
                        <Text style={styles.agentStepCheckText}>✓</Text>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.agentStepText,
                        isCurrent ? styles.agentStepTextActive : styles.agentStepTextDone,
                      ]}
                    >
                      {stepText}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* STEP 4.2: 1000ms Order Placed Success Overlay with visual timer */}
        {orderSuccessVisible ? (
          <View style={[StyleSheet.absoluteFill, styles.centerOverlay, styles.backdropDark]}>
            <View style={styles.successCard}>
              <View style={styles.successIconBadge}>
                <Text style={styles.successIconText}>✓</Text>
              </View>
              <Text style={styles.successTitle}>{t('orderPlaced')}</Text>
              <Text style={styles.successSub}>{t('orderPlacedSub')}</Text>
              <View style={styles.timerTrack}>
                <Animated.View style={[styles.timerFill, { width: timerWidth }]} />
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </QuickCommerceContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  pressed: {
    opacity: 0.82,
  },
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
  },
  backdropDark: {
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
  },
  quickViewCard: {
    position: 'absolute',
    width: '82%',
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...makeShadow(3),
  },
  quickViewImageWrap: {
    width: '100%',
    height: 210,
    backgroundColor: colors.surfaceMuted,
  },
  closePill: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePillText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '800',
  },
  quickViewBody: {
    flexGrow: 0,
    flexShrink: 1,
  },
  quickViewBodyContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  quickPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  quickHugePrice: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '900',
    color: colors.primary,
  },
  quickRegularPrice: {
    fontSize: 15,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
    fontWeight: '600',
  },
  quickProductName: {
    ...type.h2,
    color: colors.text,
  },
  unitBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  unitBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  unitBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primaryDark,
  },
  perUnitCaption: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  quickActionsFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  addToCartGreenBtn: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: '#15803D',
    borderWidth: 1,
    borderColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addToCartGreenBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  buyNowBtn: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyNowBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  miniCartSheet: {
    position: 'absolute',
    right: spacing.md,
    left: spacing.md,
    maxHeight: '78%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...makeShadow(3),
  },
  miniCartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  miniCartTitle: {
    ...type.h2,
    color: colors.text,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeCircleText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textMuted,
  },
  miniCartEmpty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  miniCartEmptyTitle: {
    ...type.h3,
    color: colors.text,
  },
  miniCartEmptyCaption: {
    ...type.caption,
    textAlign: 'center',
  },
  miniCartList: {
    flexGrow: 0,
    maxHeight: 280,
  },
  miniCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  miniCartThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  miniCartInfo: {
    flex: 1,
  },
  miniCartItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  miniCartItemMeta: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '700',
    marginTop: 2,
  },
  miniCartStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  stepperQty: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    minWidth: 18,
    textAlign: 'center',
  },
  miniCartFooter: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  subtotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subtotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
  },
  subtotalValue: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
  },
  miniCartBuyBtn: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  miniCartBuyBtnText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '800',
  },
  centerOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
    marginTop: 4,
  },
  agentLoadingCard: {
    width: '86%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...makeShadow(3),
  },
  agentStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  agentSpinnerRing: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
  },
  agentStepCheckBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentStepCheckText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.textInverse,
  },
  agentStepText: {
    flex: 1,
    fontSize: 15,
  },
  agentStepTextActive: {
    fontWeight: '800',
    color: colors.text,
  },
  agentStepTextDone: {
    fontWeight: '600',
    color: colors.textMuted,
  },
  successCard: {
    width: '86%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...makeShadow(3),
  },
  successIconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  successIconText: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.textInverse,
  },
  successTitle: {
    ...type.h2,
    color: colors.text,
    textAlign: 'center',
  },
  successSub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  timerTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  timerFill: {
    height: '100%',
    backgroundColor: '#16A34A',
  },
});
