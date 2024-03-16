"""server URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/3.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path, re_path

from rest_framework import routers

from api.views import TTSViewSet

# Allow to call api like this
# http://host/my/api
# not like this
# http://host/my/api/
router = routers.DefaultRouter(trailing_slash=False)

# TTS
router.register(r'tts', TTSViewSet, basename="tts")

urlpatterns = [
    path('api/', include(router.urls)),
    path('', include('ui.urls')),
    re_path(r'^.*/$', include('ui.urls')),
    path('admin/', admin.site.urls),
]
