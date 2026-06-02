/* RIKO EXPERIENCE - Performant JavaScript & Immersive Interactions (V3) */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialise Cinematic Preloader
    initializePreloader();

    // 2. Load dynamic CMS menu items (falls back to hardcoded HTML cards if server is unreachable)
    await loadDynamicMenu();

    // 3. Initialise Custom Cursor (Desktop Only)
    if (window.innerWidth > 991) {
        initializeCustomCursor();
    }

    // 4. Initialise Smooth Scrolling & Parallax
    initializeSmoothScrolling();

    // 5. Initialise Sticky Header Transitions
    setupHeaderScroll();

    // 6. Initialise Scroll Reveals
    setupScrollReveals();

    // 7. Initialise Interactive Menu categories & Coverflow spotlight
    initializeMenuCarousels();

    // 8. Initialise Booking Form Reservation Validation
    setupReservationForm();
});

/**
 * Cinematic Preloader reveal sequence
 */
function initializePreloader() {
    const preloader = document.getElementById('preloader');
    if (!preloader) return;

    // Wait for page resources to settle before fading out preloader
    window.addEventListener('load', () => {
        fadePreloader();
    });

    // Bounded safety timeout: preloader will fade out after 2.5s even if assets are slow
    setTimeout(fadePreloader, 2500);

    function fadePreloader() {
        if (preloader.style.opacity === '0') return;
        
        preloader.style.opacity = '0';
        preloader.style.visibility = 'hidden';
        
        // Trigger initial hero text animations after preloader fades
        setTimeout(animateHeroText, 400);
    }
}

/**
 * Animate Hero elements on page entry
 */
function animateHeroText() {
    const sub = document.querySelector('.hero-sub-luxury');
    const title = document.querySelector('.hero-title-oversized');
    const desc = document.querySelector('.hero-desc-narrative');
    const btnGroup = document.querySelector('.hero-btn-group-luxury');

    if (sub) {
        sub.style.transition = 'opacity 1s ease-out, transform 1s ease-out';
        sub.style.opacity = '1';
        sub.style.transform = 'translateY(0)';
    }

    if (title) {
        setTimeout(() => {
            title.style.transition = 'opacity 1.2s ease-out, transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)';
            title.style.opacity = '1';
            title.style.transform = 'translateY(0)';
        }, 200);
    }

    if (desc) {
        setTimeout(() => {
            desc.style.transition = 'opacity 1.2s ease-out, transform 1.2s ease-out';
            desc.style.opacity = '1';
            desc.style.transform = 'translateY(0)';
        }, 400);
    }

    if (btnGroup) {
        setTimeout(() => {
            btnGroup.style.transition = 'opacity 1s ease-out, transform 1s ease-out';
            btnGroup.style.opacity = '1';
            btnGroup.style.transform = 'translateY(0)';
        }, 600);
    }
}

/**
 * Luxury Custom Cursor movements (lag-follow lerp)
 */
function initializeCustomCursor() {
    const cursor = document.querySelector('.custom-cursor');
    const follower = document.querySelector('.custom-cursor-follower');
    if (!cursor || !follower) return;

    let mouseX = 0, mouseY = 0; // Mouse coords
    let cursorX = 0, cursorY = 0; // Cursor dot position
    let followerX = 0, followerY = 0; // Follower ring position

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        
        // Immediate position for the main gold dot
        cursor.style.left = `${mouseX}px`;
        cursor.style.top = `${mouseY}px`;
    });

    // Smooth animation loop for the lagging outer circle
    function animateCursorRing() {
        // Linear Interpolation (lerp) factor of 0.15 for smooth lag follow
        followerX += (mouseX - followerX) * 0.15;
        followerY += (mouseY - followerY) * 0.15;

        follower.style.left = `${followerX}px`;
        follower.style.top = `${followerY}px`;

        requestAnimationFrame(animateCursorRing);
    }
    requestAnimationFrame(animateCursorRing);

    // Expand circle on hover for premium links, buttons, and custom cards
    const hoverElements = document.querySelectorAll('a, button, .experience-card-bespoke, .gallery-item-bespoke, .menu-tab-btn-luxury, .menu-dish-card-bespoke');
    hoverElements.forEach(el => {
        el.addEventListener('mouseenter', () => {
            cursor.classList.add('expand');
            follower.classList.add('expand');
        });
        el.addEventListener('mouseleave', () => {
            cursor.classList.remove('expand');
            follower.classList.remove('expand');
        });
    });
}

/**
 * Scroll and mouse parallax, smooth scrolling initializations
 */
function initializeSmoothScrolling() {
    // Check if Lenis is loaded via CDN. If yes, initialise it.
    if (typeof Lenis !== 'undefined') {
        const lenis = new Lenis({
            duration: 1.4,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // Custom liquid ease-out curve
            direction: 'vertical',
            gestureDirection: 'vertical',
            smooth: true,
            mouseMultiplier: 1,
            smoothTouch: false,
            touchMultiplier: 2,
            infinite: false,
        });

        function raf(time) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);

        // Bind Lenis scroll to GSAP ScrollTrigger if both are loaded
        if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
            lenis.on('scroll', ScrollTrigger.update);
            gsap.ticker.add((time) => {
                lenis.raf(time * 1000);
            });
            gsap.ticker.lagSmoothing(0);
        }
    }

    // Parallax mouse hover response on hero and interior showcases
    const heroSec = document.getElementById('hero');
    const heroBg = document.querySelector('.hero-visual-bg');
    if (heroSec && heroBg) {
        heroSec.addEventListener('mousemove', (e) => {
            const xVal = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2) * 15; // Max 15px shift
            const yVal = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2) * 15;
            heroBg.style.transform = `scale(1.05) translate(${xVal}px, ${yVal}px)`;
        });
    }

    const interiorSec = document.getElementById('immersive-interior');
    const interiorBg = document.querySelector('.interior-visual-bg');
    if (interiorSec && interiorBg) {
        interiorSec.addEventListener('mousemove', (e) => {
            const xVal = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2) * 12;
            const yVal = (e.clientY - window.innerHeight / 2) / (window.innerHeight / 2) * 12;
            interiorBg.style.transform = `scale(1.05) translate(${xVal}px, ${yVal}px)`;
        });
    }
}

/**
 * Editorial Sticky Header transition
 */
function setupHeaderScroll() {
    const header = document.querySelector('header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

/**
 * Custom Scroll Reveals (GSAP or custom fallback IntersectionObserver)
 */
function setupScrollReveals() {
    const reveals = document.querySelectorAll('.section-reveal');
    
    // Fallback Intersection Observer (highly performant and native)
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        root: null,
        rootMargin: '0px 0px -10% 0px', // Trigger slightly before crossing into viewport
        threshold: 0.1
    });

    reveals.forEach(el => revealObserver.observe(el));

    // Simple Parallax scroll response for editorial quote
    const quote = document.querySelector('.interior-quote-text');
    if (quote) {
        window.addEventListener('scroll', () => {
            const scrollPos = window.scrollY;
            const sectionOffset = quote.parentElement.offsetTop;
            const offset = (scrollPos - sectionOffset) * 0.15; // Slow parallax shift
            quote.style.transform = `translateY(${offset}px)`;
        });
    }
}

/**
 * Menu Category Tab controls, Dot updates, Spotlights, and drag-to-scroll carousels
 */
function initializeMenuCarousels() {
    const tabBtns = document.querySelectorAll('.menu-tab-btn-luxury');
    const categorySections = document.querySelectorAll('.menu-category-section');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');

            // 1. Toggle Tab buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 2. Toggle Menu Category sections
            categorySections.forEach(section => {
                if (section.id === targetId) {
                    section.classList.add('active');
                    // Recalculate coverflow center on initial click
                    setTimeout(() => {
                        const carousel = section.querySelector('.menu-dish-carousel');
                        if (carousel) {
                            // Scroll to center initially
                            carousel.scrollLeft = 1; 
                            carousel.scrollLeft = 0;
                        }
                    }, 50);
                } else {
                    section.classList.remove('active');
                }
            });
        });
    });

    // Coverflow Spotlight & Dots mapping for all carousels
    const wrappers = document.querySelectorAll('.menu-carousel-wrapper');
    wrappers.forEach(wrapper => {
        const carousel = wrapper.querySelector('.menu-dish-carousel');
        const dotsContainer = wrapper.querySelector('.menu-dots-container');
        const cards = carousel.querySelectorAll('.menu-dish-card-bespoke');

        if (!carousel || !dotsContainer || cards.length === 0) return;

        // Reset dots container
        dotsContainer.innerHTML = '';

        // Dynamically create dot indicators
        cards.forEach((card, index) => {
            const dot = document.createElement('div');
            dot.classList.add('menu-dot');
            if (index === 0) dot.classList.add('active');

            // Dot click scrolls the card into center spotlight
            dot.addEventListener('click', () => {
                const cardWidth = card.offsetWidth;
                const scrollTarget = card.offsetLeft - (carousel.offsetWidth / 2) + (cardWidth / 2);
                carousel.scrollTo({
                    left: scrollTarget,
                    behavior: 'smooth'
                });
            });

            dotsContainer.appendChild(dot);
        });

        // 3D coverflow spotlight logic
        const updateSpotlight = () => {
            const carouselRect = carousel.getBoundingClientRect();
            const carouselCenter = carouselRect.left + (carousel.offsetWidth / 2);

            let closestIndex = 0;
            let minDistance = Infinity;

            cards.forEach((card, idx) => {
                const cardRect = card.getBoundingClientRect();
                const cardCenter = cardRect.left + (cardRect.width / 2);
                const distance = Math.abs(carouselCenter - cardCenter);

                if (distance < minDistance) {
                    minDistance = distance;
                    closestIndex = idx;
                }
            });

            // Set active scaling classes
            cards.forEach((card, idx) => {
                if (idx === closestIndex) {
                    card.classList.add('active-card');
                } else {
                    card.classList.remove('active-card');
                }
            });

            // Set active dot classes
            const dots = dotsContainer.querySelectorAll('.menu-dot');
            dots.forEach((dot, idx) => {
                if (idx === closestIndex) {
                    dot.classList.add('active');
                } else {
                    dot.classList.remove('active');
                }
            });
        };

        // Scroll listener with animation frame request
        carousel.addEventListener('scroll', () => {
            window.requestAnimationFrame(updateSpotlight);
        });

        window.addEventListener('resize', updateSpotlight);

        // Click-and-drag mouse scroll for desktop
        setupDragToScroll(carousel);

        // Run once initially
        setTimeout(updateSpotlight, 200);
    });
}

/**
 * Click-and-drag mouse scrolling
 */
function setupDragToScroll(carousel) {
    let isDown = false;
    let startX;
    let scrollLeft;

    carousel.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Only left-click
        isDown = true;
        carousel.style.cursor = 'grabbing';
        startX = e.pageX - carousel.offsetLeft;
        scrollLeft = carousel.scrollLeft;
        e.preventDefault();
    });

    carousel.addEventListener('mouseleave', () => {
        if (isDown) {
            isDown = false;
            carousel.style.cursor = 'grab';
        }
    });

    carousel.addEventListener('mouseup', () => {
        if (isDown) {
            isDown = false;
            carousel.style.cursor = 'grab';
        }
    });

    carousel.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - carousel.offsetLeft;
        const walk = (x - startX) * 1.5; // Scroll speed multiplier
        carousel.scrollLeft = scrollLeft - walk;
    });

    carousel.style.cursor = 'grab';
}

/**
 * Reservation Booking Form handler with luxury validation feedback
 */
function setupReservationForm() {
    const form = document.querySelector('.reservation-form-editorial');
    const successOverlay = document.querySelector('.reservation-success-overlay');
    const successCard = document.querySelector('.reservation-success-card');
    if (!form || !successOverlay) return;

    // Create or find error banner element
    let errorBanner = form.querySelector('.form-error-banner');
    if (!errorBanner) {
        errorBanner = document.createElement('div');
        errorBanner.className = 'form-error-banner';
        errorBanner.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        errorBanner.style.border = '1px solid #ef4444';
        errorBanner.style.color = '#fca5a5';
        errorBanner.style.padding = '12px 16px';
        errorBanner.style.fontSize = '0.78rem';
        errorBanner.style.marginBottom = '20px';
        errorBanner.style.display = 'none';
        errorBanner.style.textAlign = 'left';
        
        const submitBtn = form.querySelector('.btn-reserve-submit');
        form.insertBefore(errorBanner, submitBtn);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = form.querySelector('.btn-reserve-submit');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = "Verifying Coordinates...";
        submitBtn.disabled = true;
        errorBanner.style.display = 'none';

        const getFieldValue = (name) => {
            const field = form.querySelector(`[name="${name}"]`);
            return field ? field.value.trim() : '';
        };

        // Extract form data
        const payload = {
            name: getFieldValue('name'),
            phone: getFieldValue('phone'),
            guests: parseInt(getFieldValue('guests'), 10),
            date: getFieldValue('date'),
            time: getFieldValue('time'),
            special_request: getFieldValue('special_request')
        };

        try {
            const apiBase = getApiBase();
            const res = await fetch(`${apiBase}/api/reservations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let data = {};
            const rawBody = await res.text();
            try {
                data = rawBody ? JSON.parse(rawBody) : {};
            } catch (jsonErr) {
                throw new Error(`Reservation server returned HTTP ${res.status}: ${rawBody.slice(0, 240) || res.statusText}`);
            }
            if (res.ok && data.success) {
                // Success Modal Animate
                successOverlay.style.display = 'flex';
                setTimeout(() => {
                    successOverlay.style.opacity = '1';
                    if (successCard) {
                        successCard.style.transform = 'scale(1)';
                        successCard.style.transition = 'transform 0.6s cubic-bezier(0.25, 1, 0.5, 1)';
                    }
                }, 50);

                form.reset();

                const closeSuccess = () => {
                    successOverlay.style.opacity = '0';
                    if (successCard) {
                        successCard.style.transform = 'scale(0.9)';
                    }
                    setTimeout(() => {
                        successOverlay.style.display = 'none';
                    }, 500);
                };

                successOverlay.addEventListener('click', closeSuccess);
                setTimeout(closeSuccess, 5000);
            } else {
                // Render validation/duplicate error
                const message = data.details || data.error || `Reservation server returned HTTP ${res.status}.`;
                errorBanner.innerHTML = `<i class="fa-solid fa-circle-exclamation" style="margin-right:8px;"></i> ${escapeHtml(message)}`;
                errorBanner.style.display = 'block';
            }
        } catch (err) {
            const message = err.message || "Unable to contact concierge server. Please coordinate reservation via phone.";
            errorBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i> ${escapeHtml(message)}`;
            errorBanner.style.display = 'block';
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });
}


/**
 * Fetch and load dynamic menu cards from the CMS server APIs.
 * Supports cross-origin ports and falls back gracefully to hardcoded HTML layouts on communication errors.
 */
async function loadDynamicMenu() {
    try {
        const apiBase = getApiBase();
        const apiUrl = `${apiBase}/api/collections/menu_items?page=1&per_page=200&status=Published`;

        const res = await fetch(apiUrl);
        if (!res.ok) {
            console.log("CMS Server returned error. Falling back to static menu cards.");
            return;
        }
        
        const data = await res.json();
        const items = data.items;
        if (!items || items.length === 0) {
            console.log("No published items in CMS. Falling back to static menu cards.");
            return;
        }

        const categoryIds = {
            "For One": "for-one",
            "Salads": "salads",
            "Cold Dishes": "cold-dishes",
            "Hot Dishes": "hot-dishes",
            "Main": "main",
            "Desserts": "desserts",
            "Beverages": "beverages"
        };

        // Group database items by category
        const groups = {};
        Object.keys(categoryIds).forEach(cat => groups[cat] = []);
        items.forEach(item => {
            if (groups[item.category] !== undefined) {
                groups[item.category].push(item);
            }
        });

        // Rebuild each category's carousel HTML list dynamically
        Object.entries(categoryIds).forEach(([category, id]) => {
            const section = document.getElementById(id);
            if (!section) return;
            const carousel = section.querySelector('.menu-dish-carousel');
            if (!carousel) return;

            const categoryItems = groups[category];
            if (!categoryItems || categoryItems.length === 0) {
                carousel.innerHTML = `
                    <div style="width:100%; text-align:center; padding:50px; color:var(--color-grey); font-family:var(--font-sans); font-size:0.85rem; letter-spacing:0.05em;">
                        No dishes currently available in this category.
                    </div>
                `;
                return;
            }

            let html = '';
            categoryItems.forEach((item, index) => {
                const price = Math.round(item.price);
                const desc = item.description || '';
                
                // Construct the exact structure of card elements
                html += `
                    <!-- Dynamic Card ${index + 1}: ${escapeHtml(item.name)} -->
                    <div class="menu-dish-card-bespoke" data-hover="expand">
                        <img src="${apiBase}/${item.image_url}" alt="${escapeHtml(item.name)} | ${price} - ${escapeHtml(desc)}" class="menu-dish-visual">
                        <div class="menu-dish-info-overlay">
                            <div class="menu-dish-header-row">
                                <h3 class="menu-dish-name">${escapeHtml(item.name)}</h3>
                                <span class="menu-dish-price">${price}</span>
                            </div>
                            <p class="menu-dish-desc">${escapeHtml(desc)}</p>
                        </div>
                    </div>
                `;
            });
            carousel.innerHTML = html;
        });

        console.log("Successfully synchronized dynamic menu cards from CMS database.");
    } catch (err) {
        console.log("Could not contact CMS database. Falling back to static menu cards.", err);
    }
}

function getApiBase() {
    return '';
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
