export const IMAGE_FRAGMENT = /* GraphQL */ `
  fragment ImageFields on Image {
    url
    altText
    width
    height
  }
`;

export const MONEY_FRAGMENT = /* GraphQL */ `
  fragment MoneyFields on MoneyV2 {
    amount
    currencyCode
  }
`;

export const PRODUCT_FRAGMENT = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    availableForSale
    vendor
    productType
    tags
    featuredImage { ...ImageFields }
    sizeOrder: metafield(namespace: "custom", key: "size_order") { value }
    # 40, not 3: Shop All shows one card per colour and picks each colour's own photos by alt text.
    images(first: 40) {
      edges { node { ...ImageFields } }
    }
    variants(first: 25) {
      edges {
        node {
          id
          title
          availableForSale
          price { ...MoneyFields }
          compareAtPrice { ...MoneyFields }
          selectedOptions { name value }
          image { ...ImageFields }
        }
      }
    }
    priceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
    compareAtPriceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
  }
`;

export const COLLECTION_FRAGMENT = /* GraphQL */ `
  fragment CollectionFields on Collection {
    id
    handle
    title
    description
    image { ...ImageFields }
  }
`;

// Richer single-product fragment for the PDP: full image set, options, html body, SEO fields and the
// custom.* metafields (each needs a Storefront-visible definition in Shopify, or it comes back null).
// images(first: 50): one product now holds every colour's photos (a bag with 3 colours × ~8 shots).
export const PRODUCT_PAGE_FRAGMENT = /* GraphQL */ `
  fragment ProductPageFields on Product {
    id
    handle
    title
    description
    descriptionHtml
    availableForSale
    vendor
    productType
    tags
    options { name values }
    seo { title description }
    storySlides: metafield(namespace: "custom", key: "story_slides") { value }
    productDetails: metafield(namespace: "custom", key: "product_details") { value }
    careGuide: metafield(namespace: "custom", key: "care_guide") { value }
    shippingReturn: metafield(namespace: "custom", key: "shipping_return") { value }
    dimensions: metafield(namespace: "custom", key: "dimensions") { value }
    materialName: metafield(namespace: "custom", key: "material_name") { value }
    materialStory: metafield(namespace: "custom", key: "material_story") { value }
    warranty: metafield(namespace: "custom", key: "warranty") { value }
    featureCards: metafield(namespace: "custom", key: "feature_cards") { value }
    fullbleedImage: metafield(namespace: "custom", key: "fullbleed_image") { value }
    fullbleedImageMobile: metafield(namespace: "custom", key: "fullbleed_image_mobile") { value }
    # custom.reels = videos uploaded in Shopify admin (list of files). Shopify serves several mp4 sizes + a cover image.
    reels: metafield(namespace: "custom", key: "reels") {
      references(first: 10) { nodes { ... on Video { sources { url mimeType height } previewImage { url } } } }
    }
    tagline: metafield(namespace: "custom", key: "tagline") { value }
    faq: metafield(namespace: "custom", key: "faq") { value }
    sizeGroup: metafield(namespace: "custom", key: "size_group") { value }
    carryOptions: metafield(namespace: "shopify", key: "carry-options") {
      references(first: 10) { nodes { ... on Metaobject { handle } } }
    }
    featuredImage { ...ImageFields }
    images(first: 50) {
      edges { node { ...ImageFields } }
    }
    variants(first: 100) {
      edges {
        node {
          id
          title
          sku
          availableForSale
          price { ...MoneyFields }
          compareAtPrice { ...MoneyFields }
          selectedOptions { name value }
          image { ...ImageFields }
        }
      }
    }
    priceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
    compareAtPriceRange {
      minVariantPrice { ...MoneyFields }
      maxVariantPrice { ...MoneyFields }
    }
  }
`;

// Cart shape used by the cart page + API endpoints.
export const CART_FRAGMENT = /* GraphQL */ `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    discountCodes { applicable code }
    cost {
      subtotalAmount { ...MoneyFields }
      totalAmount { ...MoneyFields }
    }
    lines(first: 100) {
      edges {
        node {
          id
          quantity
          cost { totalAmount { ...MoneyFields } }
          merchandise {
            ... on ProductVariant {
              id
              title
              price { ...MoneyFields }
              image { ...ImageFields }
              product { title handle }
            }
          }
        }
      }
    }
  }
`;
