from django.shortcuts import render
from django.http import HttpResponse

# Create your views here.
def index(request):
  context = {}
  return HttpResponse(render(request, 'ui/index.html', context))
